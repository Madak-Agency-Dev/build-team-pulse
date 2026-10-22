import { checkPassword, sessionCookie, readJson } from '../lib/auth.js';

// Small per-instance throttle so the password can't be guessed quickly.
const attempts = new Map();

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json');
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', sessionCookie(true));
    return res.end(JSON.stringify({ ok: true }));
  }
  if (req.method !== 'POST') { res.statusCode = 405; return res.end('{}'); }
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  if (recent.length >= 10) { res.statusCode = 429; return res.end(JSON.stringify({ error: 'Too many attempts. Try again in a few minutes.' })); }
  const { password } = await readJson(req);
  if (!checkPassword(password)) {
    recent.push(now); attempts.set(ip, recent);
    await new Promise((r) => setTimeout(r, 400));
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: 'That password didn’t work.' }));
  }
  attempts.delete(ip);
  res.setHeader('Set-Cookie', sessionCookie());
  res.end(JSON.stringify({ ok: true }));
}
