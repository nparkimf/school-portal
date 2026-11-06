// Loads SAMPLE data so the dashboard has something to show. All schools and
// figures are fictional - delete them before entering real data.
// Usage: npm run seed            (only runs on an empty database)
//        npm run seed -- --force (adds sample data even if schools exist)
import { db } from './db.js';
import { LEVELS } from './constants.js';

const { n } = db.prepare('SELECT COUNT(*) AS n FROM schools').get();
if (n > 0 && !process.argv.includes('--force')) {
  console.log(`Database already has ${n} schools. Re-run with --force to add sample data anyway.`);
  process.exit(0);
}

// Small deterministic PRNG so seeded data is reproducible.
let seed = 42;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const SCHOOLS = [
  ['Sample Academy of Arlington', 'VA', 'Arlington', 'Independent', 'PK-12', 1.1],
  ['Sample Day School of Fairfax', 'VA', 'Fairfax', 'Independent', 'K-12', 1.0],
  ['Sample Montessori of Alexandria', 'VA', 'Alexandria', 'Montessori', 'PK-8', 0.8],
  ['Sample Christian School of Richmond', 'VA', 'Richmond', 'Religious', 'K-12', 0.65],
  ['Sample Prep of McLean', 'VA', 'McLean', 'Independent', '6-12', 1.25],
  ['Sample Friends School of Washington', 'DC', 'Washington', 'Religious', 'PK-8', 1.15],
  ['Sample Country Day of Georgetown', 'DC', 'Washington', 'Independent', 'K-12', 1.35],
  ['Sample Montessori of Capitol Hill', 'DC', 'Washington', 'Montessori', 'PK-6', 0.85],
  ['Sample Academy of Bethesda', 'MD', 'Bethesda', 'Independent', 'PK-12', 1.2],
  ['Sample Day School of Silver Spring', 'MD', 'Silver Spring', 'Independent', 'K-8', 0.9],
  ['Sample Catholic School of Baltimore', 'MD', 'Baltimore', 'Religious', 'PK-8', 0.55],
  ['Sample Learning Center of Rockville', 'MD', 'Rockville', 'Special Education', 'K-12', 1.0],
];

const BASE_TUITION = { 'Pre-K': 17000, Elementary: 23000, Middle: 29000, High: 34000 };
const YEARS = ['2023-2024', '2024-2025', '2025-2026', '2026-2027'];
const STATE_FACTOR = { VA: 1.0, DC: 1.15, MD: 1.05 };

const insertSchool = db.prepare(
  'INSERT OR IGNORE INTO schools (name, state, city, school_type, grades_served) VALUES (?, ?, ?, ?, ?)',
);
const findSchool = db.prepare('SELECT id FROM schools WHERE name = ? AND state = ? AND city = ?');
const insertFee = db.prepare(
  `INSERT OR IGNORE INTO tuition_fees
   (school_id, academic_year, level, tuition, registration_fee, application_fee, technology_fee,
    activity_fee, books_fee, uniform_fee, other_fee, notes, updated_by)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Sample data', 'seed')`,
);
const round50 = (v) => Math.round(v / 50) * 50;

db.exec('BEGIN');
try {
  let records = 0;
  for (const [name, state, city, type, grades, factor] of SCHOOLS) {
    insertSchool.run(name, state, city, type, grades);
    const { id } = findSchool.get(name, state, city);
    const levels = LEVELS.filter((l) => {
      if (grades === 'PK-12') return true;
      if (grades === 'K-12') return l !== 'Pre-K';
      if (grades === 'PK-8') return l !== 'High';
      if (grades === 'K-8') return l === 'Elementary' || l === 'Middle';
      if (grades === 'PK-6') return l === 'Pre-K' || l === 'Elementary';
      if (grades === '6-12') return l === 'Middle' || l === 'High';
      return true;
    });
    YEARS.forEach((year, i) => {
      const growth = Math.pow(1.04 + rand() * 0.02, i);
      for (const level of levels) {
        const tuition = round50(BASE_TUITION[level] * factor * STATE_FACTOR[state] * growth * (0.95 + rand() * 0.1));
        insertFee.run(
          id, year, level, tuition,
          round50(400 + rand() * 600), round50(75 + rand() * 100), round50(250 + rand() * 500),
          round50(300 + rand() * 900), round50(200 + rand() * 600),
          level === 'Pre-K' ? 0 : round50(150 + rand() * 450), round50(rand() * 500),
        );
        records += 1;
      }
    });
  }
  db.exec('COMMIT');
  console.log(`Seeded ${SCHOOLS.length} sample schools and ${records} tuition records.`);
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}
