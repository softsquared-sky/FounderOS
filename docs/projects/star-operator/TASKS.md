# Star operator workspace

2026-10-27 · Local setup on the operator's own fork. No upstream push or live Star dashboard deployment.

- Korean entry screen: attention, progress, waiting/scheduled, done, role filters and task search.
- Existing Star client is the only source. Import boardState from that same checkout so display semantics stay consistent.
- Whitelist title, next action, IDs, roles and provenance. Ignore raw prompts, outputs, comments, transcripts, notifications and credentials.
- Keep projection freshness separate from snapshot collection time. No fabricated counters, automatic approvals or extra agent identity.
- Manual refresh only, atomic file replacement, previous snapshot retained on failure.
- AX operating loop, branching lineage, conditional ten-stage model and component relationships use three fixed local source files, with hashes and reported verification levels.
- Verify model/source/refresh boundaries, upstream smoke net, typecheck and actual browser controls.

Local implementation and browser review complete. Public push awaits the operator's explicit yes. The original knowledge-graph UI is preserved; connecting the operator's full shared memory to that graph is outside this implemented adapter.

Validation on 2026-10-27: 360 test files exercised (4,786 cases including nine skips). The final parallel run passed 357 files and hit three timeouts. Cold module compilation was moved into fixture setup for the two remaining affected files, preserving request/render deadlines; all three files then passed (51 tests). The 16 new Star/AX tests and typecheck passed. Browser checks covered real read-only import, search, role filtering, detail, manual refresh and AX navigation. No claim of a single all-green full-suite run is made. Details: [setup](../../STAR-SETUP.md).
