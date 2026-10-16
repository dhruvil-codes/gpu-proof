# Vercel deploy (web)

1. Push `build` branch; import repo in Vercel; root directory `apps/web`.
2. Env: `NEXT_PUBLIC_API=https://<your-api-host>` (Docker API below).
3. Build: `npm run build`. No secrets in the frontend.

# API deploy (Docker)

```
docker build -f apps/api/Dockerfile -t sandboxproof-api .
docker run -p 8000:8000 --env-file .env -e USE_SIMULATOR=false sandboxproof-api
```

Needs `NEBIUS_API_KEY`, `NEBIUS_PROJECT_ID`, `NEBIUS_SUBNET_ID` in `.env` (never committed).
Local fallback: `docker compose up` (API + Postgres) and `npm --prefix apps/web run dev`.
