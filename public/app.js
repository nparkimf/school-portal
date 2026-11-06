const app = document.getElementById('app');
const sessionEl = document.getElementById('session');

let meta = null;
let user = null;
let charts = [];

const STATE_COLORS = { VA: '#2e8b57', DC: '#c0392b', MD: '#e0a800' };
const PALETTE = ['#1f4e8c', '#2e8b57', '#e0a800', '#c0392b', '#7d5ba6', '#2a9db5', '#8a8f98', '#d2691e'];

// ---------- helpers ----------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const money = (n) =>
  n == null ? '-' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) if (v !== '' && v != null) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

async function api(url, opts = {}) {
  if (window.staticApi) return window.staticApi(url, opts); // static demo build (GitHub Pages)
  const init = { method: opts.method || 'GET', headers: {} };
  if (opts.body !== undefined || init.method === 'POST' || init.method === 'PUT') {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body ?? {});
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const options = (list, selected, allLabel) =>
  (allLabel !== undefined ? [`<option value="">${esc(allLabel)}</option>`] : [])
    .concat(list.map((v) => `<option value="${esc(v)}"${String(v) === String(selected) ? ' selected' : ''}>${esc(v)}</option>`))
    .join('');

const stateTag = (s) => `<span class="tag ${esc(s)}">${esc(s)}</span>`;

function destroyCharts() {
  charts.forEach((c) => c.destroy());
  charts = [];
}

function chart(id, config) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  config.options = { responsive: true, maintainAspectRatio: false, ...config.options };
  charts.push(new Chart(canvas, config));
}

const moneyAxis = { ticks: { callback: (v) => `$${Number(v).toLocaleString('en-US')}` }, beginAtZero: true };
const moneyTooltip = { callbacks: { label: (c) => `${c.dataset.label ? `${c.dataset.label}: ` : ''}${money(c.parsed.y ?? c.parsed)}` } };

function flash(el, type, text) {
  el.innerHTML = text ? `<div class="msg ${type}" role="${type === 'error' ? 'alert' : 'status'}">${esc(text)}</div>` : '';
}

// ---------- session ----------

async function loadMeta() {
  meta = await api('/api/meta');
}

async function loadSession() {
  user = (await api('/api/auth/me')).user;
  renderSession();
}

function renderSession() {
  if (user) {
    sessionEl.innerHTML = `<span>Signed in as <strong>${esc(user.username)}</strong></span><button type="button" id="logout" class="small">Log out</button>`;
    document.getElementById('logout').addEventListener('click', async () => {
      await api('/api/auth/logout', { method: 'POST' });
      user = null;
      renderSession();
      location.hash = '#/';
      route();
    });
  } else {
    sessionEl.innerHTML = '<a href="#/login">Admin login</a>';
  }
}

// ---------- shared table of fee records ----------

function feeTable(rows, { showSchool = true, admin = false } = {}) {
  if (!rows.length) return '<div class="empty">No records found.</div>';
  const fieldCols = meta.feeFields.map((f) => `<th class="num">${esc(f.label)}</th>`).join('');
  const body = rows
    .map(
      (r) => `<tr>
        <td>${esc(r.academic_year)}</td>
        ${showSchool ? `<td><a href="#/schools/${r.school_id}">${esc(r.school_name)}</a></td><td>${stateTag(r.state)}</td>` : ''}
        <td>${esc(r.level)}</td>
        ${meta.feeFields.map((f) => `<td class="num">${money(r[f.key])}</td>`).join('')}
        <td class="num"><strong>${money(r.total)}</strong></td>
        ${admin ? `<td class="actions"><a class="btn small secondary" href="#/admin/fees/${r.id}">Edit</a><button type="button" class="small danger" data-del-fee="${r.id}">Delete</button></td>` : ''}
      </tr>`,
    )
    .join('');
  return `<div class="table-wrap"><table>
    <thead><tr><th>Year</th>${showSchool ? '<th>School</th><th>State</th>' : ''}<th>Level</th>${fieldCols}<th class="num">Total</th>${admin ? '<th></th>' : ''}</tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

function bindFeeDeletes(container, reload) {
  container.addEventListener('click', async (e) => {
    const id = e.target.dataset?.delFee;
    if (!id || !confirm('Delete this tuition record? This cannot be undone.')) return;
    try {
      await api(`/api/fees/${id}`, { method: 'DELETE' });
      await loadMeta();
      reload();
    } catch (err) {
      alert(err.message);
    }
  });
}

// ---------- dashboard ----------

const dash = { year: null, state: '', level: '' };

async function dashboardView() {
  if (dash.year === null) dash.year = meta.years[0] || '';
  app.innerHTML = `
    <h1>Tuition &amp; Fees Dashboard</h1>
    <p class="sub">Private school costs across Virginia, Washington DC and Maryland.</p>
    <div class="filters">
      <label>Academic year<select id="f-year">${options(meta.years, dash.year, 'All years')}</select></label>
      <label>State<select id="f-state">${options(meta.states, dash.state, 'All states')}</select></label>
      <label>Level<select id="f-level">${options(meta.levels, dash.level, 'All levels')}</select></label>
    </div>
    <div id="dash-body" aria-live="polite"><div class="empty">Loading...</div></div>`;
  for (const k of ['year', 'state', 'level']) {
    document.getElementById(`f-${k}`).addEventListener('change', (e) => {
      dash[k] = e.target.value;
      dashboardView();
    });
  }

  const data = await api(`/api/summary${qs(dash)}`);
  const body = document.getElementById('dash-body');
  const k = data.kpis;
  if (!k.records) {
    body.innerHTML = '<div class="card empty">No tuition records match these filters yet.</div>';
    return;
  }

  // Year-over-year change in average tuition for the selected year, weighted by record count.
  let yoy = '';
  if (dash.year) {
    const byYear = new Map();
    for (const t of data.trend) {
      const cur = byYear.get(t.year) || { sum: 0, n: 0 };
      cur.sum += t.avg_tuition * t.records;
      cur.n += t.records;
      byYear.set(t.year, cur);
    }
    const years = [...byYear.keys()].sort();
    const i = years.indexOf(dash.year);
    if (i > 0) {
      const prev = byYear.get(years[i - 1]);
      const cur = byYear.get(dash.year);
      const pct = (cur.sum / cur.n / (prev.sum / prev.n) - 1) * 100;
      yoy = `<span class="${pct > 0 ? 'up' : 'down'}">${pct > 0 ? '+' : ''}${pct.toFixed(1)}%</span> vs ${esc(years[i - 1])}`;
    }
  }

  body.innerHTML = `
    <div class="grid kpis">
      <div class="card kpi"><div class="label">Schools reporting</div><div class="value">${k.schools}</div><div class="hint">${k.records} tuition records</div></div>
      <div class="card kpi"><div class="label">Average tuition</div><div class="value">${money(k.avg_tuition)}</div><div class="hint">${yoy || '&nbsp;'}</div></div>
      <div class="card kpi"><div class="label">Median tuition</div><div class="value">${money(k.median_tuition)}</div><div class="hint">&nbsp;</div></div>
      <div class="card kpi"><div class="label">Tuition range</div><div class="value">${money(k.min_tuition)} - ${money(k.max_tuition)}</div><div class="hint">lowest to highest</div></div>
      <div class="card kpi"><div class="label">Average total cost</div><div class="value">${money(k.avg_total)}</div><div class="hint">tuition plus all fees</div></div>
    </div>
    <div class="grid two">
      <div class="card"><h2>Average tuition by state</h2><div class="chart-box"><canvas id="c-state" role="img" aria-label="Average tuition by state"></canvas></div></div>
      <div class="card"><h2>Average tuition by level</h2><div class="chart-box"><canvas id="c-level" role="img" aria-label="Average tuition by level"></canvas></div></div>
      <div class="card"><h2>Average tuition trend by year</h2><div class="chart-box"><canvas id="c-trend" role="img" aria-label="Average tuition trend by year and state"></canvas></div></div>
      <div class="card"><h2>Average additional fees</h2><div class="chart-box"><canvas id="c-fees" role="img" aria-label="Average additional fees by type"></canvas></div></div>
    </div>
    <div class="card"><h2>Summary by state</h2>${summaryTable(data.byState, 'State')}</div>
    <div class="card"><h2>Summary by level</h2>${summaryTable(data.byLevel, 'Level')}</div>
    <div class="card"><h2>Ten highest total costs</h2>${topTable(data.topSchools)}</div>`;

  destroyCharts();
  chart('c-state', {
    type: 'bar',
    data: {
      labels: data.byState.map((r) => r.label),
      datasets: [{ label: 'Avg tuition', data: data.byState.map((r) => r.avg_tuition), backgroundColor: data.byState.map((r) => STATE_COLORS[r.label]) }],
    },
    options: { plugins: { legend: { display: false }, tooltip: moneyTooltip }, scales: { y: moneyAxis } },
  });
  chart('c-level', {
    type: 'bar',
    data: {
      labels: data.byLevel.map((r) => r.label),
      datasets: [{ label: 'Avg tuition', data: data.byLevel.map((r) => r.avg_tuition), backgroundColor: '#1f4e8c' }],
    },
    options: { plugins: { legend: { display: false }, tooltip: moneyTooltip }, scales: { y: moneyAxis } },
  });
  const trendYears = [...new Set(data.trend.map((t) => t.year))].sort();
  const trendStates = [...new Set(data.trend.map((t) => t.state))];
  chart('c-trend', {
    type: 'line',
    data: {
      labels: trendYears,
      datasets: trendStates.map((s) => ({
        label: s,
        borderColor: STATE_COLORS[s],
        backgroundColor: STATE_COLORS[s],
        tension: 0.25,
        data: trendYears.map((y) => data.trend.find((t) => t.year === y && t.state === s)?.avg_tuition ?? null),
      })),
    },
    options: { plugins: { tooltip: moneyTooltip }, scales: { y: moneyAxis } },
  });
  const extra = meta.feeFields.slice(1);
  chart('c-fees', {
    type: 'doughnut',
    data: {
      labels: extra.map((f) => f.label),
      datasets: [{ data: extra.map((f) => data.feeBreakdown[f.key]), backgroundColor: PALETTE }],
    },
    options: {
      plugins: { tooltip: { callbacks: { label: (c) => `${c.label}: ${money(c.parsed)}` } }, legend: { position: 'right' } },
    },
  });
}

function summaryTable(rows, firstCol) {
  return `<div class="table-wrap"><table>
    <thead><tr><th>${firstCol}</th><th class="num">Schools</th><th class="num">Records</th><th class="num">Avg tuition</th><th class="num">Min</th><th class="num">Max</th><th class="num">Avg total cost</th></tr></thead>
    <tbody>${rows
      .map(
        (r) => `<tr><td>${firstCol === 'State' ? stateTag(r.label) : esc(r.label)}</td><td class="num">${r.schools}</td><td class="num">${r.records}</td>
        <td class="num">${money(r.avg_tuition)}</td><td class="num">${money(r.min_tuition)}</td><td class="num">${money(r.max_tuition)}</td><td class="num">${money(r.avg_total)}</td></tr>`,
      )
      .join('')}</tbody></table></div>`;
}

function topTable(rows) {
  return `<div class="table-wrap"><table>
    <thead><tr><th>School</th><th>State</th><th>City</th><th>Level</th><th class="num">Tuition</th><th class="num">Total cost</th></tr></thead>
    <tbody>${rows
      .map(
        (r) => `<tr><td><a href="#/schools/${r.id}">${esc(r.name)}</a></td><td>${stateTag(r.state)}</td><td>${esc(r.city)}</td><td>${esc(r.level)}</td>
        <td class="num">${money(r.tuition)}</td><td class="num"><strong>${money(r.total)}</strong></td></tr>`,
      )
      .join('')}</tbody></table></div>`;
}

// ---------- schools ----------

const schoolFilter = { q: '', state: '' };

async function schoolsView() {
  app.innerHTML = `
    <h1>Schools</h1>
    <p class="sub">Browse participating private schools.</p>
    <div class="filters">
      <label>Search by name<input id="s-q" type="search" value="${esc(schoolFilter.q)}"></label>
      <label>State<select id="s-state">${options(meta.states, schoolFilter.state, 'All states')}</select></label>
    </div>
    <div class="card" id="school-list"></div>`;
  const load = async () => {
    const rows = await api(`/api/schools${qs(schoolFilter)}`);
    document.getElementById('school-list').innerHTML = rows.length
      ? `<div class="table-wrap"><table>
        <thead><tr><th>School</th><th>State</th><th>City</th><th>Type</th><th>Grades</th><th class="num">Records</th><th>Latest year</th></tr></thead>
        <tbody>${rows
          .map(
            (s) => `<tr><td><a href="#/schools/${s.id}">${esc(s.name)}</a></td><td>${stateTag(s.state)}</td><td>${esc(s.city)}</td>
            <td>${esc(s.school_type)}</td><td>${esc(s.grades_served)}</td><td class="num">${s.records}</td><td>${esc(s.latest_year || '-')}</td></tr>`,
          )
          .join('')}</tbody></table></div>`
      : '<div class="empty">No schools found.</div>';
  };
  let timer;
  document.getElementById('s-q').addEventListener('input', (e) => {
    schoolFilter.q = e.target.value.trim();
    clearTimeout(timer);
    timer = setTimeout(load, 250);
  });
  document.getElementById('s-state').addEventListener('change', (e) => {
    schoolFilter.state = e.target.value;
    load();
  });
  await load();
}

async function schoolDetailView(id) {
  const { school, fees } = await api(`/api/schools/${id}`);
  const safeUrl = /^https?:\/\//i.test(school.website) ? school.website : '';
  app.innerHTML = `
    <p><a href="#/schools">&larr; All schools</a></p>
    <div class="detail-head">
      <div>
        <h1>${esc(school.name)}</h1>
        <div class="meta">${stateTag(school.state)}<span>${esc(school.city)}</span><span>${esc(school.school_type)}</span>
          ${school.grades_served ? `<span>Grades ${esc(school.grades_served)}</span>` : ''}
          ${safeUrl ? `<a href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer">Website</a>` : ''}</div>
      </div>
      ${user ? `<a class="btn secondary" href="#/admin/schools/${school.id}">Edit school</a>` : ''}
    </div>
    ${
      fees.length
        ? `<div class="card"><h2>Tuition by year</h2><div class="chart-box"><canvas id="c-school" role="img" aria-label="Tuition by year and level"></canvas></div></div>`
        : ''
    }
    <div class="card"><h2>Tuition &amp; fees history</h2><div id="school-fees">${feeTable(fees, { showSchool: false, admin: !!user })}</div></div>`;

  destroyCharts();
  if (fees.length) {
    const years = [...new Set(fees.map((f) => f.academic_year))].sort();
    const levels = meta.levels.filter((l) => fees.some((f) => f.level === l));
    chart('c-school', {
      type: 'line',
      data: {
        labels: years,
        datasets: levels.map((l, i) => ({
          label: l,
          borderColor: PALETTE[i],
          backgroundColor: PALETTE[i],
          tension: 0.25,
          data: years.map((y) => fees.find((f) => f.academic_year === y && f.level === l)?.tuition ?? null),
        })),
      },
      options: { plugins: { tooltip: moneyTooltip }, scales: { y: moneyAxis } },
    });
  }
  bindFeeDeletes(document.getElementById('school-fees'), () => schoolDetailView(id));
}

// ---------- detailed fees ----------

const feeFilter = { year: '', state: '', level: '', q: '' };

async function feesView() {
  app.innerHTML = `
    <h1>Tuition &amp; Fees - Detail</h1>
    <p class="sub">Every tuition and fee record. Filter, then export to CSV.</p>
    <div class="filters">
      <label>Academic year<select id="d-year">${options(meta.years, feeFilter.year, 'All years')}</select></label>
      <label>State<select id="d-state">${options(meta.states, feeFilter.state, 'All states')}</select></label>
      <label>Level<select id="d-level">${options(meta.levels, feeFilter.level, 'All levels')}</select></label>
      <label>School name<input id="d-q" type="search" value="${esc(feeFilter.q)}"></label>
      <a class="btn secondary" id="d-csv" href="#">Export CSV</a>
    </div>
    <div class="card"><div id="fee-count" class="sub" aria-live="polite"></div><div id="fee-list"></div></div>`;
  const load = async () => {
    document.getElementById('d-csv').href = `/api/fees.csv${qs(feeFilter)}`;
    const rows = await api(`/api/fees${qs(feeFilter)}`);
    document.getElementById('fee-count').textContent = `${rows.length} record${rows.length === 1 ? '' : 's'}`;
    document.getElementById('fee-list').innerHTML = feeTable(rows, { admin: !!user });
  };
  let timer;
  for (const k of ['year', 'state', 'level']) {
    document.getElementById(`d-${k}`).addEventListener('change', (e) => {
      feeFilter[k] = e.target.value;
      load();
    });
  }
  document.getElementById('d-q').addEventListener('input', (e) => {
    feeFilter.q = e.target.value.trim();
    clearTimeout(timer);
    timer = setTimeout(load, 250);
  });
  bindFeeDeletes(document.getElementById('fee-list'), load);
  await load();
}

// ---------- auth views ----------

let afterLogin = '#/admin';

function loginView(message) {
  app.innerHTML = `
    <form class="card login" id="login-form" novalidate>
      <h1>Admin login</h1>
      <p class="sub">School administrators sign in to enter tuition and fees.</p>
      <div id="login-msg">${message ? `<div class="msg error" role="alert">${esc(message)}</div>` : ''}</div>
      <label>Username<input name="username" autocomplete="username" required></label>
      <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
      <button type="submit">Sign in</button>
    </form>`;
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    try {
      user = (await api('/api/auth/login', { method: 'POST', body: { username: f.get('username'), password: f.get('password') } })).user;
      renderSession();
      const target = afterLogin;
      afterLogin = '#/admin';
      if (location.hash === target) route();
      else location.hash = target;
    } catch (err) {
      flash(document.getElementById('login-msg'), 'error', err.message);
    }
  });
}

// ---------- admin ----------

function adminTabs(active) {
  return `<h1>Admin</h1><div class="tabs">
    <a href="#/admin/fees" class="${active === 'fees' ? 'active' : ''}">Enter tuition &amp; fees</a>
    <a href="#/admin/schools" class="${active === 'schools' ? 'active' : ''}">Manage schools</a></div>`;
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function adminSchoolsView(editId) {
  const [schools, editing] = await Promise.all([
    api('/api/schools'),
    editId ? api(`/api/schools/${editId}`).then((r) => r.school) : null,
  ]);
  const s = editing || { name: '', state: '', city: '', school_type: 'Independent', grades_served: '', website: '' };
  app.innerHTML = `${adminTabs('schools')}
    <div class="card">
      <h2>${editing ? 'Edit school' : 'Add a school'}</h2>
      <div id="school-msg"></div>
      <form id="school-form">
        <div class="form-grid">
          <label>School name<input name="name" value="${esc(s.name)}" maxlength="150" required></label>
          <label>State<select name="state" required>${options(meta.states, s.state, 'Select...')}</select></label>
          <label>City<input name="city" value="${esc(s.city)}" maxlength="100" required></label>
          <label>Type<select name="school_type">${options(meta.schoolTypes, s.school_type)}</select></label>
          <label>Grades served<input name="grades_served" value="${esc(s.grades_served)}" placeholder="e.g. PK-8" maxlength="40"></label>
          <label>Website<input name="website" type="url" value="${esc(s.website)}" placeholder="https://"></label>
        </div>
        <div class="actions"><button type="submit">${editing ? 'Save changes' : 'Add school'}</button>
          ${editing ? '<a class="btn secondary" href="#/admin/schools">Cancel</a>' : ''}</div>
      </form>
    </div>
    <div class="card" id="school-table"><h2>All schools (${schools.length})</h2>
      <div class="table-wrap"><table><thead><tr><th>School</th><th>State</th><th>City</th><th class="num">Records</th><th></th></tr></thead>
      <tbody>${schools
        .map(
          (x) => `<tr><td><a href="#/schools/${x.id}">${esc(x.name)}</a></td><td>${stateTag(x.state)}</td><td>${esc(x.city)}</td><td class="num">${x.records}</td>
          <td class="actions"><a class="btn small secondary" href="#/admin/schools/${x.id}">Edit</a>
          <button type="button" class="small danger" data-del-school="${x.id}" data-name="${esc(x.name)}" data-records="${x.records}">Delete</button></td></tr>`,
        )
        .join('')}</tbody></table></div></div>`;

  document.getElementById('school-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('school-msg');
    try {
      await api(editing ? `/api/schools/${editing.id}` : '/api/schools', { method: editing ? 'PUT' : 'POST', body: formObject(e.target) });
      location.hash = '#/admin/schools';
      if (!editing) await adminSchoolsView();
    } catch (err) {
      flash(msg, 'error', err.message);
    }
  });
  document.getElementById('school-table').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-del-school]');
    if (!btn) return;
    const n = Number(btn.dataset.records);
    if (!confirm(`Delete "${btn.dataset.name}"${n ? ` and its ${n} tuition record(s)` : ''}? This cannot be undone.`)) return;
    try {
      await api(`/api/schools/${btn.dataset.delSchool}`, { method: 'DELETE' });
      await loadMeta();
      route();
    } catch (err) {
      flash(document.getElementById('school-msg'), 'error', err.message);
    }
  });
}

function academicYearSuggestions() {
  const now = new Date();
  const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
  const set = new Set(meta.years);
  for (let y = start - 2; y <= start + 2; y++) set.add(`${y}-${y + 1}`);
  return [...set].sort().reverse();
}

const lastEntry = { school_id: '', academic_year: '', level: '' };

async function adminFeesView(editId) {
  const [schools, editing] = await Promise.all([api('/api/schools'), editId ? api(`/api/fees/${editId}`) : null]);
  if (!schools.length) {
    app.innerHTML = `${adminTabs('fees')}<div class="card empty">Add a school first on the <a href="#/admin/schools">Manage schools</a> tab.</div>`;
    return;
  }
  const rec = editing || {
    school_id: lastEntry.school_id || schools[0].id,
    academic_year: lastEntry.academic_year || academicYearSuggestions()[0],
    level: lastEntry.level || meta.levels[0],
    notes: '',
  };
  const schoolOptions = schools
    .map((s) => `<option value="${s.id}"${Number(rec.school_id) === s.id ? ' selected' : ''}>${esc(s.name)} (${esc(s.state)})</option>`)
    .join('');

  app.innerHTML = `${adminTabs('fees')}
    <div class="card">
      <h2>${editing ? 'Edit tuition record' : 'Enter tuition &amp; fees'}</h2>
      <div id="fee-msg" aria-live="polite"></div>
      <form id="fee-form">
        <div class="form-grid">
          <label>School<select name="school_id" id="fee-school" required>${schoolOptions}</select></label>
          <label>Academic year<input name="academic_year" list="year-list" value="${esc(rec.academic_year)}" placeholder="2026-2027" pattern="\\d{4}-\\d{4}" required>
            <datalist id="year-list">${academicYearSuggestions().map((y) => `<option value="${y}">`).join('')}</datalist></label>
          <label>Level<select name="level" required>${options(meta.levels, rec.level)}</select></label>
        </div>
        <div class="form-grid">
          ${meta.feeFields
            .map(
              (f) => `<label>${esc(f.label)} ($)<input type="number" inputmode="decimal" name="${f.key}" min="0" max="500000" step="0.01"
                value="${editing && rec[f.key] ? rec[f.key] : ''}"${f.key === 'tuition' ? ' required' : ''}></label>`,
            )
            .join('')}
        </div>
        <label>Notes (optional)<textarea name="notes" maxlength="500">${esc(rec.notes)}</textarea></label>
        <div class="total-line">Total annual cost: <span id="fee-total">$0</span></div>
        <div class="actions"><button type="submit">${editing ? 'Save changes' : 'Save record'}</button>
          ${editing ? '<a class="btn secondary" href="#/admin/fees">Cancel</a>' : ''}</div>
      </form>
    </div>
    <div class="card"><h2 id="existing-title">Existing records</h2><div id="existing"></div></div>`;

  const form = document.getElementById('fee-form');
  const updateTotal = () => {
    const sum = meta.feeFields.reduce((t, f) => t + (Number(form.elements[f.key].value) || 0), 0);
    document.getElementById('fee-total').textContent = money(sum);
  };
  form.addEventListener('input', updateTotal);
  updateTotal();

  const loadExisting = async () => {
    const schoolId = form.elements.school_id.value;
    const rows = await api(`/api/fees${qs({ school_id: schoolId })}`);
    document.getElementById('existing-title').textContent = `Existing records for ${schools.find((s) => s.id === Number(schoolId))?.name || 'school'}`;
    document.getElementById('existing').innerHTML = feeTable(rows, { showSchool: false, admin: true });
  };
  document.getElementById('fee-school').addEventListener('change', loadExisting);
  bindFeeDeletes(document.getElementById('existing'), loadExisting);
  await loadExisting();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = document.getElementById('fee-msg');
    const body = formObject(form);
    try {
      await api(editing ? `/api/fees/${editing.id}` : '/api/fees', { method: editing ? 'PUT' : 'POST', body });
      await loadMeta();
      if (editing) {
        location.hash = '#/admin/fees';
        return;
      }
      // Stay on the same school/year and advance to the next level for quick entry.
      const next = meta.levels[(meta.levels.indexOf(body.level) + 1) % meta.levels.length];
      Object.assign(lastEntry, { school_id: body.school_id, academic_year: body.academic_year, level: next });
      await adminFeesView();
      flash(document.getElementById('fee-msg'), 'ok', `Saved ${body.level} for ${body.academic_year}.`);
    } catch (err) {
      flash(msg, 'error', err.message);
    }
  });
}

// ---------- router ----------

function setActiveNav(name) {
  document.querySelectorAll('.topbar nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === name));
}

async function route() {
  destroyCharts();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [page, sub, id] = parts;
  try {
    if (page === 'login') {
      setActiveNav('admin');
      return user ? (location.hash = '#/admin') : loginView();
    }
    if (page === 'admin') {
      setActiveNav('admin');
      if (!user) {
        afterLogin = location.hash;
        return loginView('Please sign in to continue.');
      }
      if (sub === 'schools') return await adminSchoolsView(id);
      return await adminFeesView(sub === 'fees' ? id : undefined);
    }
    if (page === 'schools') {
      setActiveNav('schools');
      return sub ? await schoolDetailView(sub) : await schoolsView();
    }
    if (page === 'fees') {
      setActiveNav('fees');
      return await feesView();
    }
    setActiveNav('dashboard');
    await dashboardView();
  } catch (err) {
    if (err.status === 401) {
      user = null;
      renderSession();
      afterLogin = location.hash;
      return loginView('Your session expired. Please sign in again.');
    }
    app.innerHTML = `<div class="msg error" role="alert">${esc(err.message)}</div>`;
  }
  app.focus({ preventScroll: true });
}

window.addEventListener('hashchange', route);
(async () => {
  try {
    await Promise.all([loadMeta(), loadSession()]);
    await route();
  } catch (err) {
    app.innerHTML = `<div class="msg error" role="alert">Could not load the portal: ${esc(err.message)}</div>`;
  }
})();
