# YLY_Website

This repository is a monorepo for a public registration frontend and a Cloudflare Worker backend.

## Structure

- `frontend/` — Next.js application for Cloudflare Pages
- `backend/` — Cloudflare Worker API built with TypeScript

## Setup

1. Install dependencies from the repo root:
   ```bash
   npm install
   ```
2. Install frontend dependencies:
   ```bash
   cd frontend
   npm install
   ```
3. Install backend dependencies:
   ```bash
   cd backend
   npm install
   ```

## Local development

- Frontend:
  ```bash
  cd frontend
  npm run dev
  ```
- Backend Worker:
  ```bash
  cd backend
  npm run dev
  ```

## Deployment

- Cloudflare Pages frontend deploys via `.github/workflows/pages-deploy.yml`.
- Cloudflare Worker backend deploys via `.github/workflows/worker-deploy.yml`.

## Environment

- Create `frontend/.env.local` from `frontend/.env.local.example`.
- Add Cloudflare Worker runtime vars in `backend/.dev.vars`.
- Never commit secrets or `.dev.vars`.
