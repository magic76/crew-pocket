# Security policy and deployment boundary

Crew Pocket is a **personal local-first CLI console**, not a multi-tenant hosting product. It forwards user actions to external CLIs installed under the host user's own account. It does not replace Codex/Claude/AGY runtime security or account permissions.

## Supported configuration

- Run the Web Runtime on the **host's localhost** (`127.0.0.1`, the default).
- Optional LAN pairing is intended for **trusted home/work networks only**. Verify your checkout includes the authenticated API/WebSocket pairing guard. A pairing QR is not a substitute for transport encryption; current LAN URLs use HTTP, not HTTPS.
- **Never expose port 8000 directly to the public internet** or place the Runtime behind an unauthenticated reverse proxy. Avoid untrusted/public Wi-Fi.
- CLI providers, file editing, code execution, debugging and extensions can access the host's account and workspace. Do not treat a text execution policy as a sandbox.
- Store provider credentials, conversation transcripts, Role Memory and downloaded data outside the Git checkout. The `.gitignore` file does not remove anything that has already been committed.

## Reporting vulnerabilities

Please report suspected security issues using GitHub's **private vulnerability reporting** option for this repository if available. Do not publish credentials, exploit details or private transcripts in a public issue. If private reporting is not enabled, first request a private maintainer contact without disclosing sensitive details.

## Maintainer release checks

1. Run `node scripts/check-open-source.mjs` to inspect **tracked** files for obvious secrets and private state; review findings without pasting any secret values into issues or build logs.
2. Check **the entire Git history**, not only the latest checkout, using secret scanning with push protection where supported. Rotate any exposed credential; deleting a current file is not sufficient.
3. Test a local browser/API request without credentials (must work on localhost), an unpaired LAN API/WS request (must fail), a paired LAN request (must work), and revocation (must invalidate access).
4. Verify the external CLI terms, third-party asset licenses, and model weight provenance in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
5. Avoid logging full authorization headers, pairing URLs, private prompts, transcripts, or provider tokens.
