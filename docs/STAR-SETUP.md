# Star operator profile

This fork adds a Korean workspace at `/star`. FounderOS features remain in their original routes. The Star profile routes `/` to `/star` and uses a dedicated shell. It does not replace the existing Star service, create another AI agent or copy shared memory.

## Local setup

Use Node 22 on Windows (better-sqlite3 11.10.0 has no prebuilt binary for the tested Node 24 runtime), then `npm ci`.

Create a gitignored `.env.local`:

```dotenv
FOUNDEROS_PROFILE=star
GLADOS_DEFAULT_MODE=real
DEMO_MODE=0
GLADOS_WARM=0
GLADOS_WRITES=0
GLADOS_CRON=0
GLADOS_TZ=Asia/Seoul
PORT=4188
STAR_DASHBOARD_DIR="/absolute/path/to/existing/dashboard"
STAR_DASHBOARD_URL=http://127.0.0.1:8765
STAR_AX_DIR="/absolute/path/to/local/ax-evolution"
```

Run `npm run star:sync` once and `npm run dev`. Open `http://127.0.0.1:4188/star`. The **스타에서 가져오기** button runs the same read-only import on demand. It never starts collection, a model, an approval, a task or a message.

On Windows, `scripts/start-star.ps1 -NodePath C:/path/to/node.exe -Port 4188` starts this fork in a hidden process and writes only a PID receipt and logs under `.local/`. It refuses an occupied port and does not install an automatic startup job.

The existing dashboard directory must expose `routine-client.mjs` and `board-core.mjs`. The import calls only `routineRequest('state')` using that client's existing authentication. No credentials enter this repo's local settings, snapshots or browser. No other computer's credentials or files are used.

`.local/star-snapshot.json` is a display snapshot, not a canonical ledger. It holds only whitelisted business-ticket fields and role labels. No raw prompts, results, comments, transcripts, notification previews or email settings are imported. The existing board's states and role merges are preserved; a queued request is never evidence of execution. Data older than 15 minutes is marked as an earlier snapshot. Projection verification time is displayed separately.

Approvals, responses, execution and completion continue in the existing Star dashboard. Its current UI has no ticket deep link, so the detail shows the original ID and opens the existing work board. This page does not invent an unsupported deep link.

The upstream BrainProvider defaults to gbrain and a markdown store. This fork also implements an opt-in `hindsight-star` provider and a **기억·그래프** view. Set `BRAIN_PROVIDER=hindsight-star`; under the Star profile `/brain` opens the same Star memory workspace and `/api/brain` uses Hindsight search. Without the option, the upstream provider is unchanged. Filming/demo mode cannot query the real bank.

## Hindsight Star memory

The connector is fixed to `agent-star`. It reads status, bounded graph data, recall results and the source chunk of a bank-scoped fact. It cannot retain, edit, delete, consolidate or reflect. BrainDump ingestion returns 405 when this provider is selected.

Choose one server-only configuration method:

```dotenv
# Existing Control Plane login settings, referenced from a private local file:
STAR_HINDSIGHT_CREDENTIALS_FILE="/absolute/private/hindsight-dashboard-credentials.env"
```

That file contains `HINDSIGHT_DASHBOARD_URL` and `HINDSIGHT_DASHBOARD_ACCESS_KEY`. The server uses the normal `/api/auth/login` protocol. Its own session cookie stays in server memory for up to ten minutes; no browser session is copied. The existing access key may have broader permissions upstream: the connector itself restricts the bank and allowed operations. It does not create a new restricted key or change upstream permissions.

Alternatively, configure the native Hindsight HTTP API:

```dotenv
STAR_HINDSIGHT_URL=https://your-hindsight-api.example
STAR_HINDSIGHT_API_KEY_FILE="/absolute/private/read-only-api-key.txt"
```

URLs, bank IDs, credentials and operations cannot be supplied by browser input. The local app's existing authentication, origin and loopback guards stay active. Authentication failures, missing setup, invalid responses and empty successful results remain distinct. Responses use `no-store`, stay in component memory and are not written into SQLite or the work snapshot. Credentials and live verification files must remain ignored.

The graph displays at most 120 requested nodes (server maximum 180) and up to 3,000 stored edges among displayed nodes. Excluded relationships include both out-of-view endpoints and the rendering cap. Missing type labels are joined by exact IDs from an equally bounded bank list, otherwise shown as unknown. Layout positions are visual, not semantic scores. Recall includes original chunks and supporting facts; incomplete or truncated evidence is marked unverified. The compact native BrainProvider omits unbacked matches. Source-chunk reads support both current and older Control Plane routes and verify bank/document ownership before returning text.

Protocols: [Hindsight HTTP API](https://hindsight.vectorize.io/api-reference), [Control Plane login](https://github.com/vectorize-io/hindsight/blob/main/hindsight-control-plane/src/app/api/auth/login/route.ts), and [upstream chunk-route compatibility change](https://github.com/vectorize-io/hindsight/commit/25d266937163a9236026bfa82b2b6e0d33b91ea7).

## AX flow

The optional `STAR_AX_DIR` adds the AX view to the same private snapshot. The importer reads only `architecture/catalog.json`, the first Mermaid graph in `maps/lineage.md`, and `records/2026/10/ax-20261021-ten-stage-ax-model.md`. Source hashes and source dates are shown. Missing and invalid sources have distinct states; a historical or proposed component is never marked as a verified live service.

The view contains the operating loop, the branching development lineage, the ten conditional design stages and system relationships. The stage model preserves its provisional boundaries and restored v0.4 status. It is not a universal maturity score. Operating-loop links lead to review and the existing Star workspace; they do not grant execution or canonical-adoption authority. No AX journal, meeting record or communication is imported, and none of the operator's AX originals are committed.

## Operation and recovery

Keep the default loopback bind and the upstream authentication gate. This setup does not publish the app, change firewall rules or create startup/scheduled jobs. Stop this fork's server to revert; the existing Star service and originals are untouched. Unset FOUNDEROS_PROFILE to restore the upstream shell/home.

Never commit `.env.local`, `.local/`, `data/`, runtime packages, real screenshots or API state. Public changes must contain code and synthetic tests only. The upstream AGENTS.md requires the operator's explicit yes before a push.

Validation: `npm test`, `npm run typecheck`, then the real local browser (search, role filter, detail, manual refresh and AX tabs). The fork's `docs/PROJECTS.md` records the actual completion state. Windows portability fixes cover CRLF input, drive-rooted paths and temporary-file cleanup; the original failures were reproduced on an unchanged upstream checkout before being repaired.
