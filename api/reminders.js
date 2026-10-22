import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { get, put } from '@vercel/blob';
import { isAuthed, deny, readJson } from '../lib/auth.js';

// Reminders come from data/reminders.json in the repo (Claude adds them there).
// Check-offs are saved to a private Vercel Blob, so they show for everyone at once without a redeploy.
const STATE = 'state/reminders.json';
let memory = {}; // used only when no Blob store is connected (local runs)

async function readState() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return { state: { ...memory }, etag: null };
  const r = await get(STATE, { access: 'private', useCache: false }).catch((e) => (e && e.name === 'BlobNotFoundError' ? null : Promise.reject(e)));
  if (!r || r.statusCode !== 200) return { state: {}, etag: null };
  const text = await new Response(r.stream).text();
  try { return { state: JSON.parse(text) || {}, etag: r.blob.etag }; } catch { return { state: {}, etag: r.blob.etag }; }
}

const list = () => JSON.parse(readFileSync(join(process.cwd(), 'data', 'reminders.json'), 'utf8'));

export default async function handler(req, res) {
  if (!isAuthed(req)) return deny(res);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'private, no-store');
  try {
    if (req.method === 'POST') {
      const { id, status } = await readJson(req);
      const ids = new Set(list().map((r) => r.id));
      if (!ids.has(id) || !['done', 'open'].includes(status)) { res.statusCode = 400; return res.end(JSON.stringify({ error: 'Unknown reminder' })); }
      for (let attempt = 0; attempt < 3; attempt++) {
        const { state, etag } = await readState();
        if (status === 'done') state[id] = { status: 'done', done_at: new Date().toISOString() };
        else delete state[id];
        if (!process.env.BLOB_READ_WRITE_TOKEN) { memory = state; break; }
        try {
          await put(STATE, JSON.stringify(state), { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60, ...(etag ? { ifMatch: etag } : {}) });
          break;
        } catch (e) {
          if (e && e.name === 'BlobPreconditionFailedError' && attempt < 2) continue; // someone else wrote first: re-read and apply again
          throw e;
        }
      }
    }
    const { state } = await readState();
    res.end(JSON.stringify(list().map((r) => (state[r.id] ? { ...r, ...state[r.id] } : r))));
  } catch (e) {
    console.error('[reminders]', e);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'Couldn’t save that. Try again.' }));
  }
}
