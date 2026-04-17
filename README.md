
# Project Proposal Checker (PERN)

This project runs a **PERN stack** app split into two folders:

- **Postgres** database
- **Express + Node** API in `backend/`
- **React (Vite)** frontend in `frontend/`

In production, the backend can now serve the built frontend, so you can deploy this as a **single Node web service** plus one Postgres database.

## Running locally

Install dependencies:

- `npm i --prefix frontend`
- `npm i --prefix backend`

## Database setup

Create a database and apply the schema in `backend/sql/schema.sql`.

Example with `psql`:

- `psql -U postgres -c "create database proposal_checker;"`
- `psql -U postgres -d proposal_checker -f backend/sql/schema.sql`

## Environment variables

Copy these templates and fill in your values:

- `backend/config/.env.example` -> `backend/config/.env`
- `frontend/config/.env.example` -> `frontend/config/.env` if you need a custom API URL

Notes:

- `DOCUMENT_STORAGE=database` is the best default for free hosting because uploaded PDFs are stored in Postgres instead of the server filesystem.
- `DOCUMENT_STORAGE=filesystem` is still available if you only want local uploads on disk.
- `CLIENT_ORIGIN` is optional when the backend serves the frontend from the same domain.

## Start dev servers

- API: `npm run dev:backend`
- Web: `npm run dev:frontend`

Then open the web app and register a user.

## Free hosting path

Recommended setup:

1. Push this project to GitHub.
2. Create a free Postgres database on Neon.
3. Run `backend/sql/schema.sql` against that database.
4. Create a Render web service from this repo.
5. Use the included `render.yaml`, or set these commands manually:
   - Build command: `npm install --prefix frontend && npm install --prefix backend && npm run build --prefix frontend`
   - Start command: `npm run start --prefix backend`
6. Add `DATABASE_URL` in Render from your Neon connection string.
7. Add `JWT_SECRET` in Render with a long random value.

That gives you one public URL for both the frontend and API.

## Storage note

Uploaded PDFs are stored in Postgres by default so they survive free-host restarts. This is convenient for demos and light usage. If you expect a lot of documents later, move files to object storage.

## Deploy on Vercel

This repo is also configured for a single Vercel project:

1. Push the repo to GitHub.
2. In Vercel, import the repository from the repo root.
3. Add these environment variables in the Vercel project before deploying:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `DOCUMENT_STORAGE=database`
   - `CLIENT_ORIGIN` only if you want to allow additional origins besides the same Vercel domain
4. Run `backend/sql/schema.sql` against your production Postgres database if you have not already done so.
5. Deploy.

Notes:

- `vercel.json` builds the frontend into `frontend/dist` and deploys the backend as a Vercel Function at `/api`.
- The frontend already uses the same-domain API in production, so `VITE_API_BASE` should stay unset for this Vercel setup.
- Do not use `DOCUMENT_STORAGE=filesystem` on Vercel because the function filesystem is not persistent.
