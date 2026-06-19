# open-fifa-api

Free real-time FIFA World Cup 2026 match events service. Polls FIFA's internal JSON API (`api.fifa.com/api/v3`) and exposes normalized REST + SSE endpoints.

## Quick start

```bash
cp .env.example .env
npm install
npm start
```

Or with Docker:

```bash
docker compose up --build
```

Service runs at `http://localhost:8090`.

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Service status, last poll time, live match count |
| `GET /api/matches` | All matches with status and score |
| `GET /api/live` | In-progress matches with recent events |
| `GET /api/matches/:matchId` | Single match detail |
| `GET /api/matches/:matchId/events` | Full normalized event timeline |
| `GET /api/events/recent?limit=50` | Latest events across all matches |
| `GET /api/stream` | SSE stream of new events |

## Example

```bash
curl http://localhost:8090/health
curl http://localhost:8090/api/live
curl http://localhost:8090/api/matches/400021443/events
curl -N http://localhost:8090/api/stream
```

## Configuration

See `.env.example`. Key variables:

- `WC_COMPETITION_ID` / `WC_SEASON_ID` / `WC_STAGE_ID` — FIFA tournament IDs for 2026
- `POLL_LIVE_MS` — poll interval during live matches (default 15s)
- `POLL_IDLE_MS` — poll interval when idle (default 5 min)

## Data source

Uses FIFA's undocumented public JSON API (same backend as fifa.com Match Centre). No API key required. The API may change without notice; event types unknown to the normalizer are stored as `other`.

## Deploy (GitHub + Unraid)

Same flow as [tvfifa](https://github.com/nradar/tvfifa):

1. Create an empty repo on GitHub: `Nradar/open-fifa-api` (no README).
2. Push from this folder:

```bash
git remote add origin https://github.com/Nradar/open-fifa-api.git
git push -u origin main
```

3. GitHub Actions builds and pushes `ghcr.io/nradar/open-fifa-api:latest` on every push to `main`.
4. On Unraid: add container from `unraid/open-fifa-api.xml`, or pull manually:

```bash
docker pull ghcr.io/nradar/open-fifa-api:latest
docker compose -f docker-compose.prod.yml up -d
```

**GHCR visibility:** After the first workflow run, open GitHub → Packages → `open-fifa-api` → Package settings → set visibility to **Public** so Unraid can pull without registry login.

**Unraid paths:** Mount `/mnt/user/appdata/open-fifa-api` → `/data` for snapshot persistence.

## License

MIT — for personal/non-commercial viewing assistance only.
