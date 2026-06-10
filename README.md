# TDEFA Backend

Standalone Node.js + MySQL backend for the TDEFA planilleros app.

## Requirements

- Node.js 20 or newer
- MySQL 8+

## Environment variables

Copy `.env.example` and set:

- `PORT`: HTTP port for the API. `API_PORT` is also supported for compatibility.
- `DB_HOST`
- `DB_PORT`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_AUTO_CREATE`: set to `true` only if the DB user can create the database automatically.
- `DB_SEED`: set to `true` only when you want demo data loaded on startup.

For Hostinger you can start from `.env.hostinger.example`.

## Run locally

```bash
npm install
npm start
```

The API is exposed under `/api`.

## Seed demo data

```bash
npm run seed
```

## Tests

- `npm test`: unit tests only
- `npm run test:integration`: API tests against MySQL
- `npm run test:smoke`: boot test against MySQL
- `npm run test:all`: full suite

## Deploy on hosting from this repo

1. Create the MySQL database and user in your hosting panel.
2. Add the environment variables from `.env.example`.
3. Run `npm install`.
4. Configure the startup command as `npm start` or the startup file as `index.js`.
5. If you also want this repo to serve the built frontend, copy the compiled frontend into `public/`.

By default the app does not create the database and does not inject demo data during production boots.

## Hostinger checklist

1. Create and connect a MySQL database in Hostinger.
2. Configure the variables from `.env.hostinger.example`.
3. Deploy the backend and verify `https://YOUR_DOMAIN/api/health`.
4. Point the frontend to that backend using `VITE_API_URL=https://YOUR_DOMAIN/api`.
