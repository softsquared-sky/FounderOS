# FounderOS

This fork adds an optional Korean Star operator workspace with a manual, read-only connection to an existing Star installation and private AX lineage files. See [Star setup](docs/STAR-SETUP.md). Upstream FounderOS is [Bennettxai/FounderOS](https://github.com/Bennettxai/FounderOS); its original features and license are preserved.

**A personal operating system for a one-person company: a command center that
runs your business as a set of AI-assisted departments.**

Built for whoever is holding the whole thing together: a freelancer, a
solopreneur, a solo founder, or a small team where one person still runs point.
You set the direction, AI agents cover the departments, and any employees you do
have plug into the same board.

FounderOS puts unified comms, a client funnel, social growth, finances,
Optimal Engine (your markdown knowledge base, searchable), and a roster of named
agents on one screen. Every page reads from one local SQLite database; every
integration is an honest connector that reports *not configured* until you give
it a key.

> Want to build your own, live, with guidance? That's what the cohort is for:
> [founderos.sh](https://founderos.sh)

## v3: FounderOS on GladOS

v3 is the GladOS codebase with FounderOS on top: every GladOS screen, the
FounderOS Agents board and Social pages (`founderos/`), and a demo company so a
fresh clone shows a working business instead of an empty one.

| Version | Stack | Where |
|---|---|---|
| v3 (this) | Next.js 14 + SQLite, GladOS | `main` |
| v2 | Go + SvelteKit on BusinessOS | tag `v2-businessos` |
| v1 | Next.js 14 + SQLite | tag `v1-nextjs` |

## Quick start

Requires Node 22 or newer.

```bash
npm install
npm run dev                    # http://localhost:4100
```

That's it. FounderOS opens on **demo mode**: a fictional company (twenty-two
agents, their tasks and run history, a 24-journey funnel, brand deals,
social accounts, campaigns, an Optimal Engine store of 180 pages) built into
`demo-data/` on first start and refreshed when it is a week old. Nothing in it
is real, and it never touches `data/`.

When you are ready for your own business, open **Settings** and turn
**Filming mode** off (Filming is GladOS's name for the demo data). FounderOS then reads `data/`, which starts blank: six departments,
and everything else yours to add through the UI or by wiring a connector. Set
`GLADOS_DEFAULT_MODE=real` to start every fresh install blank instead.

No login on first run: with no password set, FounderOS listens on `127.0.0.1`
only, so nothing off this machine can reach it. Open **Settings → Security** and
set an operator password whenever you want to reach it from another device; from
then on every page and API route asks for it.

`npm run dev` compiles each page on first visit, so switching pages there is
slow by design. To review or time the app as it really runs, use the preview:

```bash
npm run preview                # build into .next-preview, then serve it
npm run preview -- --no-build  # restart on the last preview build
node scripts/nav-timing.mjs --base http://127.0.0.1:4100   # page-switch timings
```

The preview has its own build folder, so a `next dev` on the same checkout is
untouched. Code changes need a new `npm run preview`. Live sources (Attio,
Stripe, Zernio and the rest) are read through a short cache that the server
fills once at start; set `GLADOS_WARM=0` to skip that warm-up.

## What's inside

| Area | Pages |
|---|---|
| Command | `/` home · `/wizard` · `/inbox` (Comms) |
| Revenue | `/funnel` · `/brand-deals` · `/clients` · `/finances` · `/trading` |
| Growth | `/social` · `/adpilot` · `/creative-engine` · `/analytics` · `/lab` (Content Lab) · `/lead-magnets` |
| Workforce | `/agents` (`/org` org chart via ⌘K) · `/chats` · `/tasks` · `/workflows` · `/skills` · `/compute` |
| Knowledge | `/brain` (Optimal Engine) · `/database` (brain files) · `/knowledge` · `/drift` |
| System | `/setup` (Settings) · `/integrations` · `/usage` · `/blueprint` (compiled system graph) · `/roadmap` |

- **Connectors** (`lib/connectors/`): email (IMAP), Slack, Notion, Attio, WhatsApp, Stripe/PayPal, Beehiiv, ManyChat, Zernio, Foreplay, the knowledge engine, a local-stack probe, and an LLM gateway. Each returns a `ConnectorStatus` and never fakes "connected".
- **Agents** (`lib/agents/`): a runtime with a registry, runs, broadcasts and chat tools. The Agents page is the FounderOS board (`founderos/`): the roster, run activity, task lanes and the Conductor, read from a Paperclip board when one is configured and from the demo company in demo mode.
- **Optimal Engine** (`lib/brain.ts`): the `/brain` page searches a markdown folder through the [gbrain](https://github.com/garrytan/gbrain) CLI, with a plain-text fallback when the CLI is absent.
- **Demo company** (`lib/demo/`): the seed behind demo mode, the same company [founderos.sh](https://founderos.sh) shows.
- **Blueprint** (`lib/blueprint/`): compiles the real registries (agents, connectors, skills, stores) into a graph so the map can never drift from the system.

## Wiring Optimal Engine

```bash
bun install -g github:garrytan/gbrain    # not the npm package of the same name
gbrain init --pglite --no-embedding
gbrain import ~/path/to/your/notes --no-embed
```

Set `GBRAIN_BIN` to the absolute binary path and `GBRAIN_STORE` to your notes
folder in `.env.local`. The embedded database is single-writer: run the CLI (as
FounderOS does) *or* a long-lived `gbrain serve`, not both at once.

## Security

There are no accounts, just one operator password, managed in **Settings →
Security** (set, change, remove, sign out every other device).

- The password is stored as a scrypt hash in `.env.local` on the host
  (`GLADOS_PASSWORD_HASH`) next to a random `GLADOS_SESSION_SECRET` that the
  httpOnly session cookie carries. Neither is ever in git. Changing the
  password rotates the secret, which signs out every other device.
- **No password = this machine only.** `npm run dev` / `npm start` bind to
  `127.0.0.1` and refuse any other `GLADOS_HOST` until a password exists. The
  gate (`middleware.ts`) also answers 503 to any non-loopback Host in that
  state, so running `next dev` by hand does not open it either.
- **Password set = login everywhere.** Set `GLADOS_HOST` to the interface you
  want (a Tailscale IP is the sane choice; `0.0.0.0` if you know why) and
  restart. Mutating cross-origin requests are refused regardless of session.
- Forgot it: delete the `GLADOS_PASSWORD_HASH` line from `.env.local`, restart,
  and set a new one from the machine it runs on (or through
  `ssh -L 4100:localhost:4100 <host>`).

## Development

```bash
npm test          # vitest: includes a smoke test that renders every page and API route
npm run typecheck
npm run build
```

## Licence

MIT. See [LICENSE](LICENSE).
