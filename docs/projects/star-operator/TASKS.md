# Star operator workspace

2026-10-27 · Local setup on the operator's own fork. No upstream push or live Star dashboard deployment.

- Korean entry screen: attention, progress, waiting/scheduled, done, role filters and task search.
- Existing Star client is the only source. Import boardState from that same checkout so display semantics stay consistent.
- Whitelist title, next action, IDs, roles and provenance. Ignore raw prompts, outputs, comments, transcripts, notifications and credentials.
- Keep projection freshness separate from snapshot collection time. No fabricated counters, automatic approvals or extra agent identity.
- Manual refresh only, atomic file replacement, previous snapshot retained on failure.
- Verify model/source/refresh boundaries, upstream smoke net, typecheck and actual browser controls.

Pending: validation and final review. Details: [setup](../../STAR-SETUP.md).
