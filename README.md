# School Portal by GHCP

A web portal for private school tuition and fees across Virginia, Washington DC and Maryland.

**Live demo:** https://nparkimf.github.io/school-portal/ — a read-only snapshot with fictional sample data (served from `docs/` by GitHub Pages; admin data entry requires running the real server). Rebuild it with `npm run build:demo`.

- **Public dashboard** — average, median and range of tuition with filters by academic year, state and level; charts by state, level, year-over-year trend and fee breakdown; summary tables and the ten highest total costs.
- **Schools** — searchable school directory, with a per-school page showing tuition history and a trend chart.
- **Tuition & Fees** — every record in detail (tuition plus registration, application, technology, activity, books, uniform and other fees) with filters and CSV export.
- **Admin** — school administrators sign in to add schools and enter tuition and fees per school, academic year and level. Copy an existing record to a new year, review and adjust its amounts, then confirm the save. The previous year's record stays unchanged.

## Tech

Node.js (>= 22.13) with Express, SQLite via the built-in `node:sqlite` module (no database server needed), and a vanilla JS + Chart.js front end. No build step.

## Run locally

```powershell
npm install
npm run seed   # optional: loads fictional sample data
npm start      # http://localhost:3000
```

## Verify

Run `npm test` for isolated API integration tests. Tests create and remove a temporary SQLite database and do not modify application data. `npm run build:demo` refreshes the read-only static demo, including local chart and icon assets.

## Annual Entry

1. Open Admin and sign in with your administrator account.
2. Add a school under Manage schools, selecting VA, DC or MD.
3. Enter tuition and optional registration, application, technology, activity, books, uniform and other fees for an academic year and level.
4. Review the calculated total and confirm Save record. Duplicate school/year/level entries are blocked; edit the existing record instead.
5. For next year, choose Copy to new year on an existing record, update the amounts and save. Dashboard filters and the school's history include the newly saved year.

The built-in account is a portal-wide administrator. Separate school-scoped permissions and Azure AD authentication are not included; configure appropriate identity and access controls before a public production deployment.

## Design Verification

- Applied the workspace's accessibility-frontend and imf-visual-design skill guidance to the public UI and static demo.
- UX checks passed for school creation, annual entry, copy-to-year, confirmation, validation feedback, filtering and logout. Required form fields have labels, active navigation is announced, and primary actions have text and icons.
- Automated axe WCAG A/AA checks passed on the tested dashboard, school directory, fee detail, login and admin-entry views. Dashboard checks covered 320px, 768px and 1440px widths; canvas-pixel checks confirmed all charts render. Enlarged text, text spacing, reduced motion and keyboard table scrolling were also checked.
- Full accessibility conformance remains unverified: manual screen-reader, high-contrast and exhaustive orientation testing are pending. Full brand-gate verification is also pending because the skill's referenced brand, accessibility and UX reference files are absent from this workspace.

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
