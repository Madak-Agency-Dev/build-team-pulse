import { isAuthed, deny } from '../lib/auth.js';

// The build team's Asana headshots. Asana's photo links are signed and expire after about a week,
// so they're fetched fresh (and kept for half an hour per server instance) rather than stored.
const TEAM = { Blair: '1202349791895266', David: '1214469730457350', Jamie: '1211211758194886' };
let cache = { at: 0, faces: null };

export default async function handler(req, res) {
  if (!isAuthed(req)) return deny(res);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'private, max-age=1800');
  const token = process.env.ASANA_TOKEN;
  if (!token) return res.end('{}');
  if (!cache.faces || Date.now() - cache.at > 30 * 60 * 1000) {
    const entries = await Promise.all(Object.entries(TEAM).map(async ([name, gid]) => {
      try {
        const r = await fetch(`https://app.asana.com/api/1.0/users/${gid}?opt_fields=photo.image_128x128`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
        const j = await r.json();
        return [name, j?.data?.photo?.image_128x128 || null];
      } catch { return [name, null]; }
    }));
    cache = { at: Date.now(), faces: Object.fromEntries(entries.filter(([, url]) => url)) };
  }
  res.end(JSON.stringify(cache.faces));
}
