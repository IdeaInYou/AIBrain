<!--
Paste this block into the CLAUDE.md of any repo where the memory hooks run.
It reinforces the deterministic mechanism — it is not the mechanism itself.
-->

## Memory

- `docs/memory/architecture.md` is the current map of this project. Read it at the start of non-trivial work.
- `docs/memory/decisions/` holds ADRs. Read the relevant ones before changing something they cover.
- When you make an architectural decision mid-session, call `memory_remember` (type `decision`) immediately;
  the session hook will create the ADR file afterwards — do not create it yourself.
- When `architecture.md` is wrong, fix it inside the marked blocks; free text outside the markers is human-owned.
  Managed lines carry a `<!-- k:… -->` key — keep it, the hook matches on it.
- Do not edit `docs/memory/sessions/` — generated.
