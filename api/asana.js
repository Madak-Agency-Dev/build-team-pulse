import { isAuthed, deny, readJson } from '../lib/auth.js';

// The only Asana call the dashboard makes: task search in the Madak workspace.
// Argument names match the Claude Asana connector's, so the page's queries move over unchanged.
const PARAMS = {
  assignee_any: 'assignee.any', followers_any: 'followers.any', projects_any: 'projects.any',
  completed: 'completed', text: 'text',
  completed_on_after: 'completed_on.after', completed_on_before: 'completed_on.before',
  completed_at_after: 'completed_at.after', completed_at_before: 'completed_at.before',
  due_on_after: 'due_on.after', due_on_before: 'due_on.before', modified_on_after: 'modified_on.after',
  sort_by: 'sort_by', sort_ascending: 'sort_ascending', opt_fields: 'opt_fields', limit: 'limit',
};

export default async function handler(req, res) {
  if (!isAuthed(req)) return deny(res);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'private, no-store');
  const token = process.env.ASANA_TOKEN;
  if (!token) { res.statusCode = 503; return res.end(JSON.stringify({ errors: [{ message: 'ASANA_TOKEN is not set in Vercel yet.' }] })); }
  const { tool, args = {} } = await readJson(req);
  if (tool && tool !== 'asana_search_tasks') { res.statusCode = 400; return res.end(JSON.stringify({ errors: [{ message: 'Unsupported call' }] })); }
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) {
    if (!(k in PARAMS) || v === null || v === undefined || v === '') continue;
    q.set(PARAMS[k], String(k === 'limit' ? Math.min(100, Number(v) || 50) : v));
  }
  const ws = process.env.ASANA_WORKSPACE || '1115873901271629';
  const r = await fetch(`https://app.asana.com/api/1.0/workspaces/${ws}/tasks/search?${q}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  });
  res.statusCode = r.status;
  res.end(await r.text());
}
