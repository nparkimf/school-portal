# School Portal

A web portal for private school tuition and fees across Virginia, Washington DC and Maryland.

**Live demo:** https://nparkimf.github.io/school-portal/ — a read-only snapshot with fictional sample data (served from `docs/` by GitHub Pages; admin data entry requires running the real server). Rebuild it with `npm run build:demo`.

- **Public dashboard** — average, median and range of tuition with filters by academic year, state and level; charts by state, level, year-over-year trend and fee breakdown; summary tables and the ten highest total costs.
- **Schools** — searchable school directory, with a per-school page showing tuition history and a trend chart.
- **Tuition & Fees** — every record in detail (tuition plus registration, application, technology, activity, books, uniform and other fees) with filters and CSV export.
- **Admin** — school administrators sign in to add schools and enter tuition and fees per school, academic year and level.

## Tech

Node.js (>= 22.13) with Express, SQLite via the built-in `node:sqlite` module (no database server needed), and a vanilla JS + Chart.js front end. No build step.

## Run locally

```powershell
npm install
npm run seed   # optional: loads fictional sample data
npm start      # http://localhost:3000
```

On first start the app creates an admin account (username `admin`) and prints a generated password **once** — save it. To choose your own credentials, set environment variables before the first start:

| Variable | Purpose | Default |
|---|---|---|
| `ADMIN_USERNAME` | First admin account name | `admin` |
| `ADMIN_PASSWORD` | First admin password | generated and printed once |
| `PORT` | HTTP port | `3000` |
| `DB_PATH` | SQLite database file | `data/school-portal.db` |
| `NODE_ENV` | Set to `production` when served over HTTPS | — |

## Notes

- Seeded schools and figures are fictional (`npm run seed`); remove them before entering real data.
- Admin sessions are held in memory, so a server restart signs admins out.
- The SQLite database lives in `data/` — back that folder up, and give it persistent storage when deploying.
