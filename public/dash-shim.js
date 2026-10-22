// A small stand-in for the Claude dashboard runtime, so the page's own scripts run unchanged on Vercel.
// Datasets load through this site's /api routes (Asana search and the standup files), behind the team password.
(function () {
  const PEOPLE_IDS = '1202349791895266,1214469730457350,1211211758194886';
  const credit = (gid) => ({ kind: 'query', tool: 'asana_search_tasks', args: { completed: true, completed_on_after: '{{since}}', completed_on_before: '{{until}}', followers_any: gid, limit: 100, opt_fields: 'name,completed_at,assignee.name,completed_by.name,projects.name', sort_by: 'completed_at' } });
  const DEFS = {
    asana_credit_blair: credit('1202349791895266'),
    asana_credit_david: credit('1214469730457350'),
    asana_credit_jamie: credit('1211211758194886'),
    asana_overdue: { kind: 'query', tool: 'asana_search_tasks', args: { assignee_any: PEOPLE_IDS, completed: false, due_on_before: '{{yesterday}}', limit: 100, opt_fields: 'name,due_on,assignee.name,projects.name', sort_ascending: true, sort_by: 'due_date' } },
    asana_week: { kind: 'query', tool: 'asana_search_tasks', args: { assignee_any: PEOPLE_IDS, completed: false, due_on_after: '{{today}}', due_on_before: '{{horizon}}', limit: 100, opt_fields: 'name,due_on,assignee.name,projects.name', sort_ascending: true, sort_by: 'due_date' } },
    commitments: { kind: 'file', name: 'commitments' },
    reminders: { kind: 'file', name: 'reminders' },
  };
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  };
  const DEFAULTS = { day: null, from: null, to: null, person: null, view: 'standup' };
  let params = { ...DEFAULTS, mode: store.get('btp-mode') === 'light' ? 'light' : 'dark' };
  document.documentElement.dataset.mode = params.mode;

  const state = {}, loaders = {}, calcs = {}, listeners = [], calcCache = {};
  let ver = 0;

  // Sign-in gate: data requests wait until the session is confirmed.
  let authed = false; let waiters = [];
  const whenAuthed = () => (authed ? Promise.resolve() : new Promise((r) => waiters.push(r)));
  const loadFaces = () => fetch('/api/people', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : {})).then((faces) => {
    window.BTP_FACES = faces || {};
    bump();
  }).catch(() => {});
  const unlock = () => { authed = true; document.documentElement.classList.remove('is-locked'); waiters.splice(0).forEach((r) => r()); loadFaces(); };
  const lock = (msg) => {
    authed = false; document.documentElement.classList.add('is-locked');
    const m = document.querySelector('.btp-login-msg'); if (m && msg) m.textContent = msg;
    const f = document.querySelector('.btp-login input'); if (f) setTimeout(() => f.focus(), 50);
  };
  window.btpAuth = { unlock, lock };

  const fill = (args) => {
    const out = {};
    for (const [k, v] of Object.entries(args)) {
      if (typeof v !== 'string') { out[k] = v; continue; }
      const whole = v.match(/^\{\{(\w+)\}\}$/);
      if (whole) { const val = params[whole[1]]; if (val !== null && val !== undefined) out[k] = val; continue; }
      out[k] = v.replace(/\{\{(\w+)\}\}/g, (_, n) => params[n] ?? '');
    }
    return out;
  };
  const usesParam = (def, names) => def.kind === 'query' && names.some((n) => JSON.stringify(def.args).includes('{{' + n + '}}'));

  async function call(tool, args) {
    const r = await fetch('/api/asana', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tool, args }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { lock('Your session ended. Sign in again.'); throw new Error('Sign in required'); }
    if (!r.ok) throw new Error((j.errors || []).map((e) => e.message).join('; ') || 'Asana error ' + r.status);
    return j;
  }
  const colsOf = (rows) => (rows.length && rows[0] && typeof rows[0] === 'object' ? Object.keys(rows[0]) : []);
  function normalize(out) {
    if (Array.isArray(out)) return { data: out, columns: colsOf(out), meta: [] };
    if (out && Array.isArray(out.rows)) return { data: out.rows, columns: out.columns || colsOf(out.rows), meta: out.meta || [], cut: !!out.cut };
    if (out && Array.isArray(out.data)) return { data: out.data, columns: out.columns || colsOf(out.data), meta: out.meta || [], cut: !!out.cut };
    return { data: out, columns: [], meta: [] };
  }

  async function load(id) {
    const def = DEFS[id];
    const st = state[id] || (state[id] = { status: 'loading', data: [], columns: [], meta: [] });
    const key = JSON.stringify(def.kind === 'query' ? fill(def.args) : def.name);
    st.key = key;
    if (st.status === 'ok') st.refreshing = true; else st.status = 'loading';
    bump();
    await whenAuthed();
    try {
      let res;
      if (def.kind === 'file') {
        const r = await fetch('/api/data?name=' + encodeURIComponent(def.name));
        if (r.status === 401) { lock('Sign in to see the dashboard.'); throw new Error('Sign in required'); }
        if (!r.ok) throw new Error('Couldn’t load ' + def.name);
        res = normalize(await r.json());
      } else {
        const args = fill(def.args);
        const answer = await call(def.tool, args);
        res = loaders[id] ? normalize(await loaders[id].fn({ answer, call, args, read: {} })) : normalize(answer);
      }
      if (st.key !== key) return;
      Object.assign(st, { status: 'ok', refreshing: false, message: null }, res);
    } catch (e) {
      if (st.key !== key) return;
      if (!authed) { st.status = 'loading'; return; }
      Object.assign(st, { status: 'error', refreshing: false, message: String(e.message || e) });
      console.error('[pulse] ' + id, e);
    }
    bump();
  }

  let queued = false;
  const run = () => { queued = false; for (const fn of listeners) { try { fn(); } catch (e) { console.error('[pulse] draw', e); } } };
  const schedule = () => { if (!queued) { queued = true; requestAnimationFrame(run); } };
  function bump() { ver++; schedule(); }

  function calcData(id) {
    const c = calcs[id];
    if (calcCache[id] && calcCache[id].ver === ver) return calcCache[id].v;
    const ins = c.inputs.map((x) => data(x));
    let v;
    const bad = ins.find((x) => x.status === 'error');
    if (bad) v = { status: 'error', data: [], columns: [], meta: [], message: bad.message };
    else if (ins.some((x) => x.status !== 'ok')) v = { status: 'loading', data: [], columns: [], meta: [] };
    else {
      try { v = { status: 'ok', ...normalize(c.fn(...ins.map((x) => x.data))), refreshing: ins.some((x) => x.refreshing) }; }
      catch (e) { console.error('[pulse] calc ' + id, e); v = { status: 'error', data: [], columns: [], meta: [], message: String(e) }; }
    }
    v.rows = v.data;
    calcCache[id] = { ver, v };
    return v;
  }
  function data(id) {
    if (DEFS[id]) { if (!state[id]) load(id); const s = state[id]; return { ...s, rows: s.data }; }
    if (calcs[id]) return calcData(id);
    return { status: 'missing', data: [], rows: [], columns: [], meta: [], message: 'Unknown source ' + id };
  }

  function setParams(obj) {
    const changed = [];
    for (const [k, v] of Object.entries(obj || {})) {
      const val = v === undefined ? null : v;
      if (JSON.stringify(params[k]) !== JSON.stringify(val)) { params[k] = val; changed.push(k); }
    }
    if (!changed.length) return;
    if (changed.includes('mode')) { store.set('btp-mode', params.mode); document.documentElement.dataset.mode = params.mode; }
    for (const id of Object.keys(DEFS)) if (state[id] && usesParam(DEFS[id], changed)) load(id);
    bump();
  }

  let rz;
  window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(bump, 120); });

  window.dash = {
    data,
    onData(fn) { listeners.push(fn); try { fn(); } catch (e) { console.error('[pulse] draw', e); } },
    calc(id, def) { calcs[id] = def; },
    loader(id, def) { loaders[id] = def; },
    params: () => ({ ...params }),
    setParams,
    resetParams() { const mode = params.mode; params = { ...DEFAULTS, mode }; for (const id of Object.keys(state)) if (DEFS[id].kind === 'query') load(id); bump(); },
    refresh(id) { if (DEFS[id]) load(id); },
    setLink(name) { try { history.replaceState(null, '', '#' + name); } catch { /* ignore */ } },
    colors: ['var(--mk-c0)', 'var(--mk-c1)', 'var(--mk-c2)', 'var(--color-fg-muted)', 'var(--color-ok)', 'var(--color-warn)', 'var(--color-bad)', 'var(--color-fg-faint)'],
  };

  // Check the session as soon as the page loads.
  fetch('/api/session', { cache: 'no-store' }).then((r) => r.json().then((j) => ({ r, j }))).then(({ r, j }) => {
    if (r.ok) unlock();
    else lock(j.configured === false ? 'The team password hasn’t been set in Vercel yet.' : '');
  }).catch(() => lock('Couldn’t reach the server. Check your connection and reload.'));
})();
