import crypto from 'node:crypto';
import { db } from './db.js';

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const sessions = new Map();

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

// Creates the first admin account if none exists. Password comes from the
// environment or is generated and printed once.
export function ensureAdmin() {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n > 0) return;
  const username = process.env.ADMIN_USERNAME || 'admin';
  const generated = !process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hashPassword(password));
  console.log('\n  First-run admin account created');
  console.log(`    username: ${username}`);
  console.log(`    password: ${password}${generated ? '   (generated - save it now, it is not shown again)' : ''}\n`);
}

const attempts = new Map();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

function rateLimited(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.reset < now) return false;
  return entry.count >= MAX_ATTEMPTS;
}

function recordFailure(ip) {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.reset < now) attempts.set(ip, { count: 1, reset: now + WINDOW_MS });
  else entry.count += 1;
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieAttrs(maxAgeSec) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${secure}`;
}

export function currentUser(req) {
  const sid = parseCookies(req.headers.cookie).sid;
  const session = sid && sessions.get(sid);
  if (!session) return null;
  if (session.expires < Date.now()) {
    sessions.delete(sid);
    return null;
  }
  return session.user;
}

export function requireAdmin(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Admin login required' });
  req.user = user;
  next();
}

export function login(req, res) {
  const ip = req.ip;
  if (rateLimited(ip)) return res.status(429).json({ error: 'Too many failed attempts. Try again later.' });

  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password are required' });
  }
  const row = db.prepare('SELECT id, username, password_hash FROM users WHERE username = ?').get(username);
  // Run the hash check even for unknown users so response time doesn't reveal which usernames exist.
  const ok = row ? verifyPassword(password, row.password_hash) : (verifyPassword(password, hashPassword('x')), false);
  if (!ok) {
    recordFailure(ip);
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const sid = crypto.randomBytes(32).toString('hex');
  sessions.set(sid, { user: { id: row.id, username: row.username }, expires: Date.now() + SESSION_TTL_MS });
  res.setHeader('Set-Cookie', `sid=${sid}; ${cookieAttrs(SESSION_TTL_MS / 1000)}`);
  res.json({ user: { id: row.id, username: row.username } });
}

export function logout(req, res) {
  const sid = parseCookies(req.headers.cookie).sid;
  if (sid) sessions.delete(sid);
  res.setHeader('Set-Cookie', `sid=; ${cookieAttrs(0)}`);
  res.json({ ok: true });
}
