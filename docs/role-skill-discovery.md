# Crew Pocket Role Skill discovery

## Design

Crew Pocket preserves native project-wide CLI instruction files (`AGENTS.md`, `CLAUDE.md`, project `.agents/skills` and provider-specific equivalents) as each provider loads them. Role DNA is separate: each Role owns its private skills and Dreaming candidates.

**New routing:** on new or changed Role catalog, the server sends only a bounded list of **verified and activated** skills (user-attested or narrowly runtime-validated). The existing working Agent decides if any apply and can call `crew_skill_list` or `crew_skill_get({skillId})` for full Markdown. There is no second model invocation and no keyword-selected full Skill injection.

The tools enforce the bound Role server-side. Codex uses its dynamic tools on new threads; existing Codex threads created without dynamic tools remain limited until a new thread. The standalone MCP process exposes the same tools when installed and configured. Claude/AGY native project Skill files are unchanged; no unsupported promise is made that their sessions have the Crew Role-bound MCP tools automatically.

## Native Markdown

When a user verifies and activates a Skill in Skill DNA, or a low-risk Skill passes narrow automatic validation, a standard `SKILL.md` is materialized at:

`~/.crew-pocket/role-skills/<role-id>/<skill-id>/SKILL.md`

Legacy JSON state at `~/.crew-pocket/role-dna.json` remains authoritative; upgraded active skills may also materialize lazily on `crew_skill_get`. The files persist across restart; deactivating a Skill removes the exported file and deleting the Role cleans up its directory.

**Security boundary:** the MCP tools enforce Role scope, but roles sharing the same Unix account and full filesystem access are **not** OS-isolated. The private Role files are deliberately not symlinked into a shared repository's native Skill folder; avoid granting other agents raw filesystem access to these directories if hard isolation is required.

## Approval and migration

Dreaming still proposes `candidate` skills. Candidates never enter the Agent catalog until either (a) a user supplies valid test/CI evidence, verifies and activates, or (b) the runtime confirms **two different completed turns** with an exact, allowlisted `node --test test/<file>.test.js` (or `tests/`) command listed verbatim in the Skill's acceptance checks, including a nonzero test count, a structured test runner summary, and zero failing tests. **All** specified commands must pass twice. Only risk-gated low-risk Skills qualify; high-risk, unclear, subjective and generic-check Skills require human review. This is an intentionally conservative first step: it is not a guarantee that all Skill steps were followed, and it never executes model-authored commands itself. Generic `test`/`lint`/`build` exit codes do not promote a Candidate. Scoped test failures demote previously auto-validated Skills, while human-attested Skills keep their existing manual review behavior. Skills previously auto-activated based on generic runtime checks are quarantined from the new catalog until the user selects **重新人工審核**, supplies fresh evidence, verifies and reactivates them.

Read-only context/skill catalog retrieval does not prove the Agent used a Skill; the old usage history remains historical attribution only. Existing sessions cannot erase a previously injected Skill from model history; a changed catalog explicitly announces revocation, and creating a new thread guarantees a clean Skill index.
