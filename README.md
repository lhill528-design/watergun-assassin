# Watergun Assassin

A real-life elimination game app: players are assigned a target, "eliminate"
them with a water gun, submit video evidence for admin approval, and climb
the leaderboard. Built with Expo Router (iOS/Android/web from one codebase)
and an Express/tRPC backend.

Game features include power-ups (offensive/defensive/chaos), a Roulette
banner, achievements, bounties, Sniper's Duels, sanctuary safe zones, map
power-up pickups, purge rounds, and a full admin panel for running a game
(round control, player management, elimination review, fee tracking).

---

## Tech stack

| Concern | Technology |
|---|---|
| App framework | Expo Router (React Native + `react-native-web`) |
| API | Express + tRPC v11 (`server/`) |
| Database | Drizzle ORM against TiDB Cloud (MySQL-compatible, serverless) |
| Auth | Clerk (passwordless email-code sign-in) |
| File storage | Cloudinary (elimination videos, direct client-to-Cloudinary signed uploads) |
| Push notifications | Expo push service |
| Backend hosting | Railway (`pnpm start` runs the esbuild-bundled server) |
| Web hosting | Vercel (serves the static `expo export --platform web` output) |
| Native builds | EAS Build |

---

## Project structure

```
app/                  Expo Router screens (file-based routing)
  (tabs)/             Bottom-tab screens: home, map, shop, profile
  admin/               Admin panel screens
components/           Shared UI components (game-map.tsx has a native/web split)
constants/             App-wide constants (API base URL, etc.)
drizzle/               Drizzle schema, relations, and SQL migrations
hooks/                 Shared React hooks (use-auth.ts wraps Clerk + the local user row)
lib/                   Client-side helpers (tRPC client, game context, location tracking)
server/
  routers.ts            tRPC procedures -- almost all app logic lives here
  db.ts                 Drizzle query helpers
  storage.ts             Cloudinary signed-upload issuance + video URL validation
  power-up-rules.ts       Pure game-rule functions (unit tested)
  push-service.ts         Expo push notification sending
  _core/                  Framework plumbing: env, tRPC context/auth, Express entry point
shared/                Types/constants shared between client and server
scripts/               One-off maintenance/admin scripts (run with tsx)
```

Test files live next to what they test (`*.test.ts`, run by Vitest), not in
a separate `tests/` directory.

---

## Local development

```bash
pnpm install
cp .env.example .env   # then fill in real values, see below
pnpm dev                # runs the Express/tRPC server (port 3000) and Metro web (port 8081) together
```

`pnpm dev` runs `dev:server` (the API, via `tsx watch`) and `dev:metro`
(`expo start --web`) concurrently. For native, use `pnpm ios` / `pnpm android`
(requires the API server running separately, and `EXPO_PUBLIC_API_BASE_URL`
pointed at a reachable host, not `localhost`, if testing on a physical device).

### Environment variables

`.env.example` is the source of truth for every variable and documents each
one inline (including which deploy platform — Railway vs. Vercel — actually
reads it). At a glance:

| Variable | Where it's read | Purpose |
|---|---|---|
| `DATABASE_URL` | Railway | TiDB Cloud connection string |
| `CLERK_SECRET_KEY` | Railway | Verifies session tokens server-side |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Vercel (build-time) + native builds | Clerk client SDK |
| `OWNER_CLERK_ID` | Railway | Optional: force a specific Clerk user to super-admin |
| `CLERK_AUTHORIZED_PARTIES` | Railway | Optional `azp` claim allowlist (see `server/_core/context.ts`) |
| `EXPO_PUBLIC_API_BASE_URL` | Vercel (build-time) + native builds | Where the client sends API requests |
| `CORS_ALLOWED_ORIGINS` | Railway | Browser origins allowed to call the API in production |
| `CLOUDINARY_CLOUD_NAME` / `CLOUDINARY_API_KEY` / `CLOUDINARY_API_SECRET` | Railway | Signs elimination-video uploads |

`EXPO_PUBLIC_*` variables are inlined into the JS bundle at build time by
Expo, not read at runtime — they must be set in Vercel's/EAS's build-time env
vars, not just in a local `.env`.

---

## Authentication

Clerk handles passwordless email-code sign-in (`components/sign-in-form.tsx`
implements the custom flow against Clerk's classic API). The client attaches
a fresh Clerk session token as a `Bearer` header on every tRPC request
(`lib/trpc.ts`); the server verifies it with `@clerk/backend`'s `verifyToken`
and lazily provisions a local `users` row on first sight
(`server/_core/context.ts`). There's no cookie-based flow and no platform
split — native and web authenticate identically.

- `publicProcedure` — no auth required.
- `protectedProcedure` — requires a valid session (`ctx.user` is guaranteed).
- `adminProcedure` — requires `ctx.user.role === "admin"`.

---

## Database

Schema lives in `drizzle/schema.ts`. After editing it:

```bash
pnpm db:push   # drizzle-kit generate && drizzle-kit migrate
```

`server/db.ts` holds query helpers; `getDb()` lazily creates the Drizzle
client from `DATABASE_URL` so local tooling can still run without a live DB.

---

## File storage

Elimination videos never pass through this server. The client requests a
signed Cloudinary upload (`storage.getEliminationUploadSignature`,
implemented in `server/storage.ts`), uploads directly to Cloudinary with that
signature, then submits the resulting URL. The server validates that URL
server-side (`isValidEliminationVideoUrl`) before trusting it — checking
protocol, host, cloud name, and that it's under the exact per-game folder the
signature was issued for. Each signature is pinned to a fresh random
`public_id` with `overwrite: false`, so it can create at most one asset.

---

## Testing

```bash
pnpm test    # vitest run
pnpm check   # tsc --noEmit
```

Tests currently cover `server/power-up-rules.ts` (pure game-rule math),
`server/storage.ts` (Cloudinary URL validation + signature params), and
`components/game-map-html.ts` (the native map's popup HTML escaping).

---

## Deployment

- **Backend (Railway):** `railway.json` runs `pnpm run build:server`
  (esbuild-bundles `server/_core/index.ts` to `dist/index.js`) and starts it
  with `pnpm start`. Set the Railway-scoped env vars from the table above.
- **Web (Vercel):** `vercel.json` runs `pnpm run build:web` (`expo export
  --platform web`) and serves `dist/client` as a static site. Set the
  Vercel-scoped env vars from the table above as build-time variables.
- **Native (EAS):** `eas.json` defines `development` / `preview` /
  `production` / `production-apk` build profiles. Run `eas build` as usual;
  `app.config.ts` defines the bundle ID, scheme, and permissions.

---

## Troubleshooting

| Issue | Likely cause |
|---|---|
| "Database not available" | `DATABASE_URL` isn't set or TiDB Cloud connection failed |
| Requests fail with 401 everywhere | `CLERK_SECRET_KEY` misconfigured, or `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` is for a different Clerk instance |
| Browser requests blocked by CORS in production | Add the origin to `CORS_ALLOWED_ORIGINS` on Railway |
| Elimination upload rejected after a successful Cloudinary upload | `isValidEliminationVideoUrl` — check the URL matches `https://res.cloudinary.com/<CLOUDINARY_CLOUD_NAME>/video/upload/.../eliminations/<gameId>/...` |
| `pnpm check` fails after a schema change | Re-run `pnpm db:push` so `drizzle/schema.ts`'s inferred types match |
