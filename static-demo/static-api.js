// Static backend for the GitHub Pages demo. app.js routes every api() call
// here when window.staticApi exists; responses mirror the Express API but are
// computed from a bundled data.json snapshot. Read-only: writes are refused.
(function () {
  let dataPromise = null;
  const load = () => (dataPromise ??= fetch(new URL('./data.json', document.baseURI)).then((r) => {
    if (!r.ok) throw new Error('Could not load demo data');
    return r.json();
  }));

  const err = (status, message) => Object.assign(new Error(message), { status });
  const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  const median = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  function filterFees(d, f) {
    return d.fees.filter(
      (r) =>
        (!f.year || r.academic_year === f.year) &&
        (!f.state || r.state === f.state) &&
        (!f.level || r.level === f.level) &&
        (!f.school_id || r.school_id === Number(f.school_id)) &&
        (!f.q || r.school_name.toLowerCase().includes(f.q.toLowerCase())),
    );
  }

  const byYearDesc = (a, b) =>
    b.academic_year.localeCompare(a.academic_year) ||
    a.school_name.localeCompare(b.school_name) ||
    a.level.localeCompare(b.level);

  function group(rows, keyFn) {
    const m = new Map();
    for (const r of rows) {
      const k = keyFn(r);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
    }
    return m;
  }

  const stats = (label, rows) => ({
    label,
    records: rows.length,
    schools: new Set(rows.map((r) => r.school_id)).size,
    avg_tuition: avg(rows.map((r) => r.tuition)),
    min_tuition: Math.min(...rows.map((r) => r.tuition)),
    max_tuition: Math.max(...rows.map((r) => r.tuition)),
    avg_total: avg(rows.map((r) => r.total)),
  });

  function summary(d, q) {
    const rows = filterFees(d, { year: q.get('year'), state: q.get('state'), level: q.get('level') });
    const trendRows = filterFees(d, { state: q.get('state'), level: q.get('level') });
    const tuitions = rows.map((r) => r.tuition);
    const levelOrder = d.meta.levels;
    return {
      kpis: {
        records: rows.length,
        schools: new Set(rows.map((r) => r.school_id)).size,
        avg_tuition: avg(tuitions),
        min_tuition: rows.length ? Math.min(...tuitions) : null,
        max_tuition: rows.length ? Math.max(...tuitions) : null,
        avg_total: avg(rows.map((r) => r.total)),
        median_tuition: median(tuitions),
      },
      byState: [...group(rows, (r) => r.state)].map(([k, v]) => stats(k, v)).sort((a, b) => a.label.localeCompare(b.label)),
      byLevel: [...group(rows, (r) => r.level)].map(([k, v]) => stats(k, v)).sort((a, b) => levelOrder.indexOf(a.label) - levelOrder.indexOf(b.label)),
      trend: [...group(trendRows, (r) => `${r.academic_year}|${r.state}`)]
        .map(([k, v]) => ({ year: v[0].academic_year, state: v[0].state, avg_tuition: avg(v.map((r) => r.tuition)), records: v.length }))
        .sort((a, b) => a.year.localeCompare(b.year)),
      feeBreakdown: rows.length
        ? Object.fromEntries(d.meta.feeFields.map((f) => [f.key, avg(rows.map((r) => r[f.key]))]))
        : null,
      topSchools: [...rows]
        .sort((a, b) => b.total - a.total)
        .slice(0, 10)
        .map((r) => ({ id: r.school_id, name: r.school_name, state: r.state, city: r.city, level: r.level, tuition: r.tuition, total: r.total })),
    };
  }

  window.staticApi = async function staticApi(url, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const u = new URL(url, document.baseURI);
    const q = u.searchParams;
    const p = u.pathname.slice(u.pathname.indexOf('/api/'));

    if (method !== 'GET') {
      if (p === '/api/auth/logout') return { ok: true };
      if (p === '/api/auth/login') throw err(403, 'This is a read-only demo - admin sign-in is disabled.');
      throw err(403, 'This is a read-only demo - changes cannot be saved.');
    }

    const d = await load();
    if (p === '/api/meta') return d.meta;
    if (p === '/api/auth/me') return { user: null };
    if (p === '/api/summary') return summary(d, q);
    if (p === '/api/schools') {
      return d.schools.filter(
        (s) =>
          (!q.get('state') || s.state === q.get('state')) &&
          (!q.get('q') || s.name.toLowerCase().includes(q.get('q').toLowerCase())),
      );
    }
    let m = /^\/api\/schools\/(\d+)$/.exec(p);
    if (m) {
      const school = d.schools.find((s) => s.id === Number(m[1]));
      if (!school) throw err(404, 'School not found');
      const fees = d.fees
        .filter((r) => r.school_id === school.id)
        .sort((a, b) => b.academic_year.localeCompare(a.academic_year) || a.level.localeCompare(b.level));
      return { school, fees };
    }
    if (p === '/api/fees') {
      return filterFees(d, {
        year: q.get('year'), state: q.get('state'), level: q.get('level'),
        school_id: q.get('school_id'), q: q.get('q'),
      }).sort(byYearDesc);
    }
    m = /^\/api\/fees\/(\d+)$/.exec(p);
    if (m) {
      const row = d.fees.find((r) => r.id === Number(m[1]));
      if (!row) throw err(404, 'Record not found');
      return row;
    }
    throw err(404, 'Not available in the demo');
  };

  // The CSV export link points at the server API; build the file in the browser instead.
  function csvCell(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  document.addEventListener('click', async (e) => {
    const link = e.target.closest('#d-csv');
    if (!link) return;
    e.preventDefault();
    const d = await load();
    const q = new URL(link.getAttribute('href'), document.baseURI).searchParams;
    const rows = filterFees(d, {
      year: q.get('year'), state: q.get('state'), level: q.get('level'), q: q.get('q'),
    }).sort(byYearDesc);
    const cols = [
      ['academic_year', 'Academic Year'], ['school_name', 'School'], ['state', 'State'], ['city', 'City'], ['level', 'Level'],
      ...d.meta.feeFields.map((f) => [f.key, f.label]),
      ['total', 'Total'], ['notes', 'Notes'],
    ];
    const lines = [cols.map((c) => csvCell(c[1])).join(',')];
    for (const r of rows) lines.push(cols.map((c) => csvCell(r[c[0]])).join(','));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' }));
    a.download = 'tuition-fees.csv';
    a.click();
    URL.revokeObjectURL(a.href);
  });
})();
