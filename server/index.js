import express from 'express';
import path from 'node:path';
import { db, TOTAL_SQL } from './db.js';
import { ensureAdmin, requireAdmin, currentUser, login, logout } from './auth.js';
import { STATES, LEVELS, SCHOOL_TYPES, FEE_FIELDS, MAX_AMOUNT } from './constants.js';

const app = express();
const root = path.join(import.meta.dirname, '..');

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'",
  );
  next();
});

// Reject state-changing requests that aren't JSON (blocks simple cross-site form posts).
app.use('/api', (req, res, next) => {
  if ((req.method === 'POST' || req.method === 'PUT') && !req.is('application/json')) {
    return res.status(415).json({ error: 'Content-Type must be application/json' });
  }
  next();
});

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = (msg) => new HttpError(400, msg);

// ---------- validation ----------

function validYear(y) {
  const m = /^(\d{4})-(\d{4})$/.exec(y || '');
  return !!m && Number(m[2]) === Number(m[1]) + 1 && Number(m[1]) >= 2000 && Number(m[1]) <= 2100;
}

function cleanSchool(body) {
  const b = body || {};
  const str = (v) => (typeof v === 'string' ? v.trim() : '');
  const school = {
    name: str(b.name),
    state: str(b.state).toUpperCase(),
    city: str(b.city),
    school_type: str(b.school_type) || 'Independent',
    grades_served: str(b.grades_served),
    website: str(b.website),
  };
  if (!school.name || school.name.length > 150) throw bad('School name is required (max 150 characters)');
  if (!STATES.includes(school.state)) throw bad(`State must be one of ${STATES.join(', ')}`);
  if (!school.city || school.city.length > 100) throw bad('City is required (max 100 characters)');
  if (!SCHOOL_TYPES.includes(school.school_type)) throw bad('Invalid school type');
  if (school.grades_served.length > 40) throw bad('Grades served is too long');
  if (school.website && !/^https?:\/\/[^\s]+$/i.test(school.website)) throw bad('Website must start with http:// or https://');
  if (school.website.length > 300) throw bad('Website is too long');
  return school;
}

function cleanFee(body) {
  const b = body || {};
  const fee = {
    school_id: Number(b.school_id),
    academic_year: typeof b.academic_year === 'string' ? b.academic_year.trim() : '',
    level: b.level,
    notes: typeof b.notes === 'string' ? b.notes.trim().slice(0, 500) : '',
  };
  if (!Number.isInteger(fee.school_id)) throw bad('School is required');
  if (!validYear(fee.academic_year)) throw bad('Academic year must look like 2025-2026');
  if (!LEVELS.includes(fee.level)) throw bad(`Level must be one of ${LEVELS.join(', ')}`);
  for (const { key, label } of FEE_FIELDS) {
    const raw = b[key] === '' || b[key] == null ? 0 : Number(b[key]);
    if (!Number.isFinite(raw) || raw < 0 || raw > MAX_AMOUNT) {
      throw bad(`${label} must be a number between 0 and ${MAX_AMOUNT.toLocaleString('en-US')}`);
    }
    fee[key] = Math.round(raw * 100) / 100;
  }
  if (fee.tuition <= 0) throw bad('Tuition must be greater than 0');
  return fee;
}

function translateDbError(err) {
  const msg = String(err.message);
  if (msg.includes('UNIQUE constraint failed: tuition_fees')) {
    return new HttpError(409, 'Fees for this school, year and level already exist. Edit the existing record instead.');
  }
  if (msg.includes('UNIQUE constraint failed: schools')) {
    return new HttpError(409, 'A school with this name already exists in that city and state.');
  }
  return err;
}

// ---------- query helpers ----------

// Builds a WHERE clause from whitelisted query filters. Table aliases: f = tuition_fees, s = schools.
function buildFilters(q, { year = true, state = true, level = true, school = true, search = false } = {}) {
  const where = [];
  const params = [];
  if (year && q.year) {
    if (!validYear(q.year)) throw bad('Invalid year filter');
    where.push('f.academic_year = ?');
    params.push(q.year);
  }
  if (state && q.state) {
    if (!STATES.includes(q.state)) throw bad('Invalid state filter');
    where.push('s.state = ?');
    params.push(q.state);
  }
  if (level && q.level) {
    if (!LEVELS.includes(q.level)) throw bad('Invalid level filter');
    where.push('f.level = ?');
    params.push(q.level);
  }
  if (school && q.school_id) {
    const id = Number(q.school_id);
    if (!Number.isInteger(id)) throw bad('Invalid school filter');
    where.push('f.school_id = ?');
    params.push(id);
  }
  if (search && q.q) {
    where.push("s.name LIKE ? ESCAPE '\\'");
    params.push(`%${String(q.q).replace(/[\\%_]/g, '\\$&')}%`);
  }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

const FEE_SELECT = `
  SELECT f.*, (${TOTAL_SQL}) AS total, s.name AS school_name, s.state, s.city
  FROM tuition_fees f JOIN schools s ON s.id = f.school_id`;

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---------- auth ----------

app.post('/api/auth/login', login);
app.post('/api/auth/logout', logout);
app.get('/api/auth/me', (req, res) => res.json({ user: currentUser(req) }));

// ---------- reference data ----------

app.get('/api/meta', (req, res) => {
  const years = db.prepare('SELECT DISTINCT academic_year FROM tuition_fees ORDER BY academic_year DESC').all();
  res.json({
    states: STATES,
    levels: LEVELS,
    schoolTypes: SCHOOL_TYPES,
    feeFields: FEE_FIELDS,
    years: years.map((y) => y.academic_year),
  });
});

// ---------- schools ----------

app.get('/api/schools', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.state) {
    if (!STATES.includes(req.query.state)) throw bad('Invalid state filter');
    where.push('s.state = ?');
    params.push(req.query.state);
  }
  if (req.query.q) {
    where.push("s.name LIKE ? ESCAPE '\\'");
    params.push(`%${String(req.query.q).replace(/[\\%_]/g, '\\$&')}%`);
  }
  const rows = db
    .prepare(
      `SELECT s.*,
         (SELECT COUNT(*) FROM tuition_fees WHERE school_id = s.id) AS records,
         (SELECT MAX(academic_year) FROM tuition_fees WHERE school_id = s.id) AS latest_year
       FROM schools s ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY s.name`,
    )
    .all(...params);
  res.json(rows);
});

app.get('/api/schools/:id', (req, res) => {
  const school = db.prepare('SELECT * FROM schools WHERE id = ?').get(Number(req.params.id));
  if (!school) throw new HttpError(404, 'School not found');
  const fees = db
    .prepare(`${FEE_SELECT} WHERE f.school_id = ? ORDER BY f.academic_year DESC, f.level`)
    .all(school.id);
  res.json({ school, fees });
});

app.post('/api/schools', requireAdmin, (req, res) => {
  const s = cleanSchool(req.body);
  try {
    const r = db
      .prepare('INSERT INTO schools (name, state, city, school_type, grades_served, website) VALUES (?, ?, ?, ?, ?, ?)')
      .run(s.name, s.state, s.city, s.school_type, s.grades_served, s.website);
    res.status(201).json({ id: Number(r.lastInsertRowid), ...s });
  } catch (e) {
    throw translateDbError(e);
  }
});

app.put('/api/schools/:id', requireAdmin, (req, res) => {
  const s = cleanSchool(req.body);
  try {
    const r = db
      .prepare('UPDATE schools SET name = ?, state = ?, city = ?, school_type = ?, grades_served = ?, website = ? WHERE id = ?')
      .run(s.name, s.state, s.city, s.school_type, s.grades_served, s.website, Number(req.params.id));
    if (!r.changes) throw new HttpError(404, 'School not found');
    res.json({ id: Number(req.params.id), ...s });
  } catch (e) {
    throw translateDbError(e);
  }
});

app.delete('/api/schools/:id', requireAdmin, (req, res) => {
  const r = db.prepare('DELETE FROM schools WHERE id = ?').run(Number(req.params.id));
  if (!r.changes) throw new HttpError(404, 'School not found');
  res.json({ ok: true });
});

// ---------- tuition & fees ----------

app.get('/api/fees', (req, res) => {
  const { clause, params } = buildFilters(req.query, { search: true });
  const rows = db
    .prepare(`${FEE_SELECT} ${clause} ORDER BY f.academic_year DESC, s.name, f.level`)
    .all(...params);
  res.json(rows);
});

function csvCell(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

app.get('/api/fees.csv', (req, res) => {
  const { clause, params } = buildFilters(req.query, { search: true });
  const rows = db
    .prepare(`${FEE_SELECT} ${clause} ORDER BY f.academic_year DESC, s.name, f.level`)
    .all(...params);
  const cols = [
    ['academic_year', 'Academic Year'],
    ['school_name', 'School'],
    ['state', 'State'],
    ['city', 'City'],
    ['level', 'Level'],
    ...FEE_FIELDS.map((f) => [f.key, f.label]),
    ['total', 'Total'],
    ['notes', 'Notes'],
  ];
  const lines = [cols.map((c) => csvCell(c[1])).join(',')];
  for (const r of rows) lines.push(cols.map((c) => csvCell(r[c[0]])).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="tuition-fees.csv"');
  res.send(lines.join('\r\n'));
});

app.get('/api/fees/:id', (req, res) => {
  const row = db.prepare(`${FEE_SELECT} WHERE f.id = ?`).get(Number(req.params.id));
  if (!row) throw new HttpError(404, 'Record not found');
  res.json(row);
});

app.post('/api/fees', requireAdmin, (req, res) => {
  const f = cleanFee(req.body);
  if (!db.prepare('SELECT 1 FROM schools WHERE id = ?').get(f.school_id)) throw bad('School does not exist');
  const cols = ['school_id', 'academic_year', 'level', ...FEE_FIELDS.map((x) => x.key), 'notes', 'updated_by'];
  try {
    const r = db
      .prepare(`INSERT INTO tuition_fees (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(...cols.map((c) => (c === 'updated_by' ? req.user.username : f[c])));
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  } catch (e) {
    throw translateDbError(e);
  }
});

app.put('/api/fees/:id', requireAdmin, (req, res) => {
  const f = cleanFee(req.body);
  if (!db.prepare('SELECT 1 FROM schools WHERE id = ?').get(f.school_id)) throw bad('School does not exist');
  const cols = ['school_id', 'academic_year', 'level', ...FEE_FIELDS.map((x) => x.key), 'notes'];
  try {
    const r = db
      .prepare(
        `UPDATE tuition_fees SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_by = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(...cols.map((c) => f[c]), req.user.username, Number(req.params.id));
    if (!r.changes) throw new HttpError(404, 'Record not found');
    res.json({ ok: true });
  } catch (e) {
    throw translateDbError(e);
  }
});

app.delete('/api/fees/:id', requireAdmin, (req, res) => {
  const r = db.prepare('DELETE FROM tuition_fees WHERE id = ?').run(Number(req.params.id));
  if (!r.changes) throw new HttpError(404, 'Record not found');
  res.json({ ok: true });
});

// ---------- dashboard summary ----------

app.get('/api/summary', (req, res) => {
  const filtered = buildFilters(req.query, { school: false });
  const trendFilter = buildFilters(req.query, { year: false, school: false });
  const FROM = 'FROM tuition_fees f JOIN schools s ON s.id = f.school_id';
  const agg = `COUNT(*) AS records, COUNT(DISTINCT f.school_id) AS schools,
    AVG(f.tuition) AS avg_tuition, MIN(f.tuition) AS min_tuition, MAX(f.tuition) AS max_tuition,
    AVG(${TOTAL_SQL}) AS avg_total`;

  const overall = db.prepare(`SELECT ${agg} ${FROM} ${filtered.clause}`).get(...filtered.params);
  const tuitions = db.prepare(`SELECT f.tuition ${FROM} ${filtered.clause}`).all(...filtered.params).map((r) => r.tuition);

  const byState = db
    .prepare(`SELECT s.state AS label, ${agg} ${FROM} ${filtered.clause} GROUP BY s.state ORDER BY s.state`)
    .all(...filtered.params);

  const byLevel = db
    .prepare(`SELECT f.level AS label, ${agg} ${FROM} ${filtered.clause} GROUP BY f.level`)
    .all(...filtered.params)
    .sort((a, b) => LEVELS.indexOf(a.label) - LEVELS.indexOf(b.label));

  const trend = db
    .prepare(
      `SELECT f.academic_year AS year, s.state, AVG(f.tuition) AS avg_tuition, COUNT(*) AS records
       ${FROM} ${trendFilter.clause} GROUP BY f.academic_year, s.state ORDER BY f.academic_year`,
    )
    .all(...trendFilter.params);

  const feeBreakdown = db
    .prepare(`SELECT ${FEE_FIELDS.map((x) => `AVG(f.${x.key}) AS ${x.key}`).join(', ')} ${FROM} ${filtered.clause}`)
    .get(...filtered.params);

  const topSchools = db
    .prepare(
      `SELECT s.id, s.name, s.state, s.city, f.academic_year, f.level, f.tuition, (${TOTAL_SQL}) AS total
       ${FROM} ${filtered.clause} ORDER BY total DESC LIMIT 10`,
    )
    .all(...filtered.params);

  res.json({
    kpis: { ...overall, median_tuition: median(tuitions) },
    byState,
    byLevel,
    trend,
    feeBreakdown: overall.records ? feeBreakdown : null,
    topSchools,
  });
});

// ---------- static & errors ----------

app.use('/vendor', express.static(path.join(root, 'node_modules', 'chart.js', 'dist')));
app.use('/icons', express.static(path.join(root, 'node_modules', 'lucide', 'dist', 'umd')));
app.use(express.static(path.join(root, 'public')));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, req, res, _next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Internal server error' : err.message });
});

ensureAdmin();
const port = Number(process.env.PORT) || 3000;
app.listen(port, () => console.log(`School Portal by GHCP running at http://localhost:${port}`));
