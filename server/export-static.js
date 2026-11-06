// Builds the static GitHub Pages demo into docs/: seeds a throwaway database,
// snapshots it to data.json, and copies the front end plus the static-demo
// overrides. Usage: npm run build:demo
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const root = path.join(import.meta.dirname, '..');
const docs = path.join(root, 'docs');
const tmpDb = path.join(os.tmpdir(), `school-portal-demo-${process.pid}.db`);
process.env.DB_PATH = tmpDb;

const { db, TOTAL_SQL } = await import('./db.js');
await import('./seed.js');
const { STATES, LEVELS, SCHOOL_TYPES, FEE_FIELDS } = await import('./constants.js');

const data = {
  meta: {
    states: STATES,
    levels: LEVELS,
    schoolTypes: SCHOOL_TYPES,
    feeFields: FEE_FIELDS,
    years: db.prepare('SELECT DISTINCT academic_year FROM tuition_fees ORDER BY academic_year DESC').all().map((r) => r.academic_year),
  },
  schools: db
    .prepare(
      `SELECT s.*,
         (SELECT COUNT(*) FROM tuition_fees WHERE school_id = s.id) AS records,
         (SELECT MAX(academic_year) FROM tuition_fees WHERE school_id = s.id) AS latest_year
       FROM schools s ORDER BY s.name`,
    )
    .all(),
  fees: db
    .prepare(
      `SELECT f.*, (${TOTAL_SQL}) AS total, s.name AS school_name, s.state, s.city
       FROM tuition_fees f JOIN schools s ON s.id = f.school_id
       ORDER BY f.academic_year DESC, s.name, f.level`,
    )
    .all(),
};

db.close();
for (const suffix of ['', '-wal', '-shm']) fs.rmSync(tmpDb + suffix, { force: true });

fs.rmSync(docs, { recursive: true, force: true });
fs.mkdirSync(docs, { recursive: true });
fs.writeFileSync(path.join(docs, 'data.json'), JSON.stringify(data));
fs.writeFileSync(path.join(docs, '.nojekyll'), '');
for (const [from, file] of [
  ['public', 'app.js'],
  ['public', 'styles.css'],
  ['static-demo', 'index.html'],
  ['static-demo', 'static-api.js'],
]) {
  fs.copyFileSync(path.join(root, from, file), path.join(docs, file));
}

console.log(`Demo built in docs/ - ${data.schools.length} schools, ${data.fees.length} fee records.`);
