import { isAuthed } from '../lib/auth.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = isAuthed(req) ? 200 : 401;
  res.end(JSON.stringify({ ok: res.statusCode === 200, configured: !!process.env.TEAM_PASSWORD }));
}
