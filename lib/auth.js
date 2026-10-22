import { createHmac, timingSafeEqual } from 'node:crypto';

const COOKIE = 'btp_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// The session token is derived from the team password, so changing TEAM_PASSWORD in Vercel signs everyone out.
const tokenFor = (password) => createHmac('sha256', password).update('build-team-pulse/v1').digest('hex');

const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

export function isAuthed(req) {
  const pw = process.env.TEAM_PASSWORD;
  if (!pw) return false;
  const raw = req.headers.cookie || '';
  const m = raw.split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  return !!m && safeEqual(m.slice(COOKIE.length + 1), tokenFor(pw));
}

export function checkPassword(given) {
  const pw = process.env.TEAM_PASSWORD;
  return !!pw && typeof given === 'string' && safeEqual(given, pw);
}

export function sessionCookie(clear = false) {
  const value = clear ? '' : tokenFor(process.env.TEAM_PASSWORD);
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${clear ? 0 : MAX_AGE}`;
}

export function deny(res) {
  res.statusCode = 401;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'Sign in required' }));
}

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}
