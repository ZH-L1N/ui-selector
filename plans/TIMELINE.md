# Timeline

<!-- Grammar: - YYYY-MM-DD HH:MM | <version|—> | <shipped|decided|hardware|deprecated|note> | <one-line summary> [| temp: <intent note>] [| supersedes: <YYYY-MM-DD|version>] -->
<!-- - YYYY-MM-DD HH:MM | vX.Y.Z | shipped | <one-line summary of what shipped> -->
- 2026-08-22 18:07 | 2026-08-22 | shipped | ui-selector MVP bookmarklet (Tasks 1-12) | temp: Phase 0 manual checks pending (real bookmarklet click under strict CSP, cross-browser/sync, Claude artifact frame topology); shot-live e2e skips on this machine
- 2026-08-22 20:19 | 2026-08-22 | decided | Claude artifacts cut from v1 — nested three frames deep, no workaround at any depth; per-artifact random subdomains cannot be trusted | supersedes: 2026-08-22
- 2026-08-22 20:40 | 2026-08-22 | note | Actionability run 1: 8/12 faithful (bar 80%) — leaf elements pixel-exact, containers fail on one gap (no child-subtree capture); two UA-default serializations were causing invented styling, now suppressed | temp: child-subtree capture deferred to v1.1
