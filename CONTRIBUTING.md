# Contributing to Crew Pocket

Crew Pocket is a personal, self-hosted Web/Mobile shell for external AI CLIs. Keep CLI execution, conversation history, Role ownership and Memory behavior intact unless a change explicitly targets them.

## Before submitting a PR

1. Fork or create a branch, make focused changes and explain what user-facing behavior changed.
2. Validate JavaScript syntax using `node --check` for changed files, and run focused tests under `test/` with `node --test`. For local code, `node scripts/check-open-source.mjs` checks tracked file hygiene.
3. Include a manual mobile smoke checklist when editing maps, Chat streaming, Role switches, LAN pairing, or Android WebView.
4. Never commit tokens, session transcripts, private prompts, signed APKs, user photos or real devices' configuration.
5. Third-party source/assets require upstream URL, license, author credit and redistribution permission; update [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

For security vulnerabilities, consult [SECURITY.md](SECURITY.md) instead of filing a public exploit report.

## Boundaries

Do not silently restart an active runtime, delete historical messages, migrate Role ownership, change CLI approval/sandbox behavior, or expand network exposure in a UI-only PR. A GitHub Actions check is not a substitute for hands-on validation against a live host environment.
