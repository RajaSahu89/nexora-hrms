# NEXORA HRMS

Full-stack HR system: React + Vite + TypeScript + Tailwind (frontend), Express + TypeScript (backend), PostgreSQL + Prisma.
One command starts both servers.

## Requirements
- Node.js 20+ and npm
- PostgreSQL 14+ running locally (create nothing by hand; Prisma creates the database)

## Run it (one terminal runs frontend + backend)
```bash
cp .env.example .env        # edit DATABASE_URL (user/password) and JWT_ACCESS_SECRET
npm install                 # installs root + frontend + backend
npm run setup               # prisma generate + create tables + seed demo data
npm run dev                 # API (5000) + website (5173) together, one terminal
```
Open http://localhost:5173. Vite proxies `/api` and `/uploads` to the API.

## Run as one production server (no Vite)
```bash
npm run start:all           # builds the website, then the API serves site + API on http://localhost:5000
```

## Dev logins (password for all: `Password@123`)
| Role | Email |
|---|---|
| Super Admin | admin@nexora.test |
| HR Admin | hr@nexora.test |
| Manager | manager@nexora.test |
| Employee | employee@nexora.test |

Development only. Remove the seed users before any real deployment.

## Deploy (single service, Render)
1. Run `npm run setup` locally once, then push the whole folder to GitHub (include `prisma/migrations`, never `.env`).
   Without a migrations folder the server falls back to `prisma db push`.
2. Render dashboard > New > Blueprint > pick the repo. `render.yaml` creates the web service and the PostgreSQL database.
3. After the first deploy, set `CLIENT_URL` to your Render URL (used in password-reset links).
4. Seed once from your computer: `DATABASE_URL="<Render external DB URL>" npm run db:seed`, log in as admin, change every dev password.
5. Keep `ALLOW_REGISTRATION=false`. Free tiers sleep when idle, and uploaded files are lost on restart unless you add a persistent disk.
Any Node host works the same way: build = `npm install --include=dev && npx prisma generate && npm run build:web`,
start = `npx prisma migrate deploy && npm start`.

## Useful commands
| Command | What it does |
|---|---|
| `npm run dev` | API + web together |
| `npm run db:studio` | browse the database |
| `npm run db:reset` | wipe DB, re-run migrations and seed |
| `npm run build` | type-check + production build of both apps |

## Structure
```
frontend/src  components, layouts, pages, contexts, hooks, services, routes, utils, types
backend/src   routes, middleware, utils, config, validators, services, types
prisma/       schema.prisma, seed.ts
uploads/      employees (public photos), documents, resumes (auth-protected), company
```

## Security notes
JWT access token (15 min) + rotating refresh cookie (httpOnly, hashed in DB), bcrypt, role checks on every API route
(scoped by role: HR all, manager = own team, employee = self), Zod validation, Helmet, rate limiting, upload type + size +
content checks, audit log. Payroll rows are `ESTIMATED` until HR finalizes them; only `FINALIZED`/`PAID` payslips are visible to employees.

## Honest status
This project was assembled without the ability to install packages or run PostgreSQL, so **it has not been executed end to end**.
Static checks done: every import resolves, backend/seed TypeScript parses. Not done: `npm install`, `tsc`, running the servers,
clicking through each page. Expect to fix a few small bugs on first run; `npm run dev` does not type-check, `npm run build` does.
Folders/files under `backend/src/controllers`, `services/employeeService|payrollService|pdfService`, `validators/index.ts`,
`utils/{asyncHandler,settings,storage,errors}.ts`, `middleware/upload.ts` are an earlier generation that nothing imports
(excluded from `tsc`); safe to delete once you are happy.
