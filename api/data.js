import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isAuthed, deny } from '../lib/auth.js';

const FILES = { commitments: 'commitments.json', reminders: 'reminders.json' };

export default function handler(req, res) {
  if (!isAuthed(req)) return deny(res);
  const name = new URL(req.url, 'http://x').searchParams.get('name');
  const file = FILES[name];
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'private, no-store');
  if (!file) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'Unknown data file' })); }
  res.end(readFileSync(join(process.cwd(), 'data', file), 'utf8'));
}
