# Star operator workspace

2026-10-27 · Local setup on the operator's own fork. No upstream push or live Star dashboard deployment.

- Korean entry screen: attention, progress, waiting/scheduled, done, role filters and task search.
- Existing Star client is the only source. Import boardState from that same checkout so display semantics stay consistent.
- Whitelist title, next action, IDs, roles and provenance. Ignore raw prompts, outputs, comments, transcripts, notifications and credentials.
- Keep projection freshness separate from snapshot collection time. No fabricated counters, automatic approvals or extra agent identity.
- Manual refresh only, atomic file replacement, previous snapshot retained on failure.
- AX operating loop, branching lineage, conditional ten-stage model and component relationships use three fixed local source files, with hashes and reported verification levels.
- Verify model/source/refresh boundaries, upstream smoke net, typecheck and actual browser controls.

Local implementation and browser review complete. Public push awaits the operator's explicit yes. A follow-up adds the existing Hindsight `agent-star` bank: server-only Control Plane authentication or native API authentication, live status, recall with original evidence, bounded stored-relationship graph and source detail. `BRAIN_PROVIDER=hindsight-star` also connects native Optimal Engine search; `/brain` uses the Star memory workspace under this profile. No bank copy or memory mutation is implemented.

Validation on 2026-10-27: 360 test files exercised (4,786 cases including nine skips). The final parallel run passed 357 files and hit three timeouts. Cold module compilation was moved into fixture setup for the two remaining affected files, preserving request/render deadlines; all three files then passed (51 tests). The 16 new Star/AX tests and typecheck passed. Browser checks covered real read-only import, search, role filtering, detail, manual refresh and AX navigation. No claim of a single all-green full-suite run is made. Details: [setup](../../STAR-SETUP.md).

Hindsight follow-up validation: nine affected test files, 51 tests passed; typecheck passed. Authentication/session isolation, caller-selected bank/URL rejection, demo isolation, no-ingestion, evidence completeness, bounded streams, graph ID joins and legacy source-route ownership are covered. Live status, a scoped graph, recall with a complete setup source, and a 1,830-character source-chunk read were verified; private data and receipts remain outside Git.
