import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';

test('School Portal annual tuition workflow', { timeout: 30000 }, async (suite) => {
  const folder = await mkdtemp(path.join(tmpdir(), 'school-portal-test-'));
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const password = randomUUID();
  const child = spawn(process.execPath, [path.join(import.meta.dirname, 'index.js')], {
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), DB_PATH: path.join(folder, 'test.db'), ADMIN_USERNAME: 'test-admin', ADMIN_PASSWORD: password },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let cookie = '';
  const request = async (url, method = 'GET', body, authenticated = true) => {
    const response = await fetch(`http://127.0.0.1:${port}${url}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(authenticated && cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, headers: response.headers, data: await response.json() };
  };
  try {
    await new Promise((resolve, reject) => {
      let output = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (output.includes('running at http://localhost:')) resolve();
      });
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`Server exited before startup (${code})`)));
    });
    await suite.test('public reporting and protected writes', async () => {
      assert.equal((await request('/api/summary')).data.kpis.records, 0);
      assert.equal((await request('/api/schools', 'POST', { name: 'Unauthorized' }, false)).status, 401);
      assert.equal((await request('/api/auth/login', 'POST', { username: 'test-admin', password: 'wrong' })).status, 401);
      const login = await request('/api/auth/login', 'POST', { username: 'test-admin', password });
      assert.equal(login.status, 200);
      cookie = login.headers.get('set-cookie').split(';')[0];
      assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
    });
    let school;
    await suite.test('create schools in VA, DC and MD; reject other states', async () => {
      for (const state of ['VA', 'DC', 'MD']) {
        const created = await request('/api/schools', 'POST', { name: `${state} Test School`, state, city: 'Test City' });
        assert.equal(created.status, 201);
        if (state === 'VA') school = created.data;
      }
      assert.equal((await request('/api/schools', 'POST', { name: 'Other', state: 'NY', city: 'Test City' })).status, 400);
      assert.equal((await request('/api/schools?state=MD')).data.length, 1);
    });
    const fee = { academic_year: '2026-2027', level: 'Elementary', tuition: 20000.25, registration_fee: 100.5, application_fee: 50, technology_fee: 200, activity_fee: 75, books_fee: 125, uniform_fee: 80, other_fee: 25, notes: 'Annual fees, including books' };
    let recordId;
    await suite.test('save cents, notes and every fee category; prevent duplicates', async () => {
      fee.school_id = school.id;
      const created = await request('/api/fees', 'POST', fee);
      assert.equal(created.status, 201);
      recordId = created.data.id;
      const saved = (await request(`/api/fees/${recordId}`)).data;
      assert.equal(saved.total, 20655.75);
      assert.equal(saved.notes, fee.notes);
      assert.equal((await request('/api/fees', 'POST', fee)).status, 409);
      assert.equal((await request('/api/fees', 'POST', { ...fee, academic_year: '2027-2029' })).status, 400);
      assert.equal((await request('/api/fees', 'POST', { ...fee, tuition: -1 })).status, 400);
    });
    await suite.test('copy to a new year without overwriting history and edit independently', async () => {
      const copied = await request('/api/fees', 'POST', { ...fee, academic_year: '2027-2028', tuition: 21000.25 });
      assert.equal(copied.status, 201);
      assert.equal((await request(`/api/fees/${recordId}`)).data.tuition, 20000.25);
      assert.equal((await request(`/api/fees/${copied.data.id}`, 'PUT', { ...fee, academic_year: '2027-2028', tuition: 22000.25 })).status, 200);
      assert.equal((await request('/api/schools/' + school.id)).data.fees.length, 2);
    });
    await suite.test('dashboard filters, median, total and history', async () => {
      const summary = (await request('/api/summary?year=2026-2027&state=VA&level=Elementary')).data;
      assert.equal(summary.kpis.schools, 1);
      assert.equal(summary.kpis.records, 1);
      assert.equal(summary.kpis.median_tuition, 20000.25);
      assert.equal(summary.kpis.avg_total, 20655.75);
      assert.equal(summary.trend.length, 2);
      assert.equal((await request('/api/fees?year=2027-2028&state=VA&level=Elementary&q=VA')).data.length, 1);
      assert.equal((await request('/api/summary?state=DC')).data.kpis.records, 0);
      assert.deepEqual((await request('/api/meta')).data.years, ['2027-2028', '2026-2027']);
    });
    await suite.test('CSV export includes filtered records and quoted notes', async () => {
      const response = await fetch(`http://127.0.0.1:${port}/api/fees.csv?year=2026-2027`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/csv/);
      const csv = await response.text();
      assert.match(csv, /20655\.75/);
      assert.match(csv, /"Annual fees, including books"/);
      assert.doesNotMatch(csv, /2027-2028/);
    });
    await suite.test('delete records, logout and reject further writes', async () => {
      assert.equal((await request(`/api/fees/${recordId}`, 'DELETE')).status, 200);
      assert.equal((await request(`/api/fees/${recordId}`)).status, 404);
      assert.equal((await request('/api/auth/logout', 'POST', {})).status, 200);
      assert.equal((await request('/api/fees', 'POST', fee)).status, 401);
    });
  } finally {
    if (child.exitCode === null) {
      const stopped = once(child, 'exit');
      child.kill();
      await stopped;
    }
    await rm(folder, { recursive: true, force: true });
  }
});