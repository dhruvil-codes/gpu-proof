# Deployment Guide

## 1. Web Frontend Deployment (Vercel / Node)

1. Root directory: `apps/web`.
2. Build command: `npm run build`. Output directory: `.next`.
3. Required Environment Variables:
   - `BACKEND_API_URL=https://<your-api-host>` (Required at build time for `/api/certifications` proxy rewrites)
   - `NEXT_PUBLIC_API=https://<your-api-host>` (Used client-side by browser hooks)
   - `NEXT_PUBLIC_ALLOW_SIM=true` (Optional: allows toggle to simulator mode in UI)
4. No secrets are exposed or embedded in the frontend bundle.

## 2. API Backend Deployment (Docker)

Build from repo root:

```bash
docker build -f apps/api/Dockerfile -t sandboxproof-api .
docker run -d -p 8000:8000 --env-file .env -e USE_SIMULATOR=false sandboxproof-api
```

Or using Docker Compose:

```bash
docker compose up -d
```

### Required Backend Environment Variables

- `NEBIUS_API_KEY`: Token Factory API key (used for Nemotron models and Contree microVMs)
- `NEBIUS_PROJECT_ID`: Nebius project ID (for Contree Sandboxes)
- `NEBIUS_REGION`: Region (default `eu-north1`)
- `USE_SIMULATOR`: Set to `false` for live execution on Nebius Contree; `true` for offline simulator
- `MAX_BUDGET_USD`: Safety hard cap (default `20.00`)
- `MAX_PER_RUN_USD`: Per-cert safety limit (default `10.00`)
- `TAVILY_API_KEY`: Optional; enables live market pricing grounding
