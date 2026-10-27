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

The upstream BrainProvider uses gbrain and a markdown store. This Star adapter does not yet call Hindsight or populate Optimal Engine's graph from `agent-star`. Star's existing memory service remains separate; a work-ticket snapshot is not a memory-bank integration.

## AX flow

The optional `STAR_AX_DIR` adds the AX view to the same private snapshot. The importer reads only `architecture/catalog.json`, the first Mermaid graph in `maps/lineage.md`, and `records/2026/10/ax-20261021-ten-stage-ax-model.md`. Source hashes and source dates are shown. Missing and invalid sources have distinct states; a historical or proposed component is never marked as a verified live service.

The view contains the operating loop, the branching development lineage, the ten conditional design stages and system relationships. The stage model preserves its provisional boundaries and restored v0.4 status. It is not a universal maturity score. Operating-loop links lead to review and the existing Star workspace; they do not grant execution or canonical-adoption authority. No AX journal, meeting record or communication is imported, and none of the operator's AX originals are committed.

## Operation and recovery

Keep the default loopback bind and the upstream authentication gate. This setup does not publish the app, change firewall rules or create startup/scheduled jobs. Stop this fork's server to revert; the existing Star service and originals are untouched. Unset FOUNDEROS_PROFILE to restore the upstream shell/home.

Never commit `.env.local`, `.local/`, `data/`, runtime packages, real screenshots or API state. Public changes must contain code and synthetic tests only. The upstream AGENTS.md requires the operator's explicit yes before a push.

Validation: `npm test`, `npm run typecheck`, then the real local browser (search, role filter, detail, manual refresh and AX tabs). The fork's `docs/PROJECTS.md` records the actual completion state. Windows portability fixes cover CRLF input, drive-rooted paths and temporary-file cleanup; the original failures were reproduced on an unchanged upstream checkout before being repaired.
