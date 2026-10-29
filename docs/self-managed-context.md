# Self-Managed Context (CTXAgent-inspired, opt-in)

This is an incremental extension to Crew Pocket's existing Context Health, Safe Compact, AutoCompact, Role Memory and CLI-native sessions. It is **not** the CTXAgent Python harness and does **not** give Pocket full control over the provider's internal token history.

Source: [CTXAgent](https://github.com/MatthiasHBusch/CTXAgent), *Self-Controlled Context Management of LLM Agents* (Busch et al., 2026), CC BY 4.0. The Node.js implementation here is new and uses only the published design ideas.

## Opt in / rollback

Turn on **AutoCompact** in Pocket settings. The default remains off and no archive is written while it is off. Turning it back off prevents new proposals, curation, recall and post-turn archive capture; existing data is not deleted. Existing native Manual Compact and /compact routes are unchanged.

The context tools are exposed as Codex **dynamic tools** on new Role-bound Codex threads when supported, and through the dedicated single-Role stdio MCP server. Existing Codex threads are not implicitly reset, and AGY/Claude do not suddenly receive model-driven tools.

## Agent tools

- crew_context_propose({summary,keepIds?}): a model-written milestone handoff proposal. The minimum 40-character summary should include goals, decisions, completed changes, verification, and open issues. keepIds are advisory. The model does not execute compaction from inside its active turn.
- crew_context_list({limit?}): list the active session's indexed, readable tool output segments (IDs, names, sizes, and curation notes).
- crew_context_curate({items:[{id,note}]}): annotate an existing archived segment. **This does not remove that tool output from the native provider context.**
- crew_context_recall({id,offset?,maxChars?}): fetch an original archived segment in pages (up to 12,000 chars each). No cross-Role, cross-provider, or cross-conversation lookup.

Post-turn, the existing AutoCompact engine rechecks Role locks, provider support, health, budget and cooldown. A valid model proposal may request the **same existing provider-native safe compact path** when pressure >= 45%, stale content >= 25%, or a recognized task-stage transition occurred. Pending requests never bypass those gates. A normal AutoCompact can still trigger without a proposal.

## Archive

The sidecar stores readable, complete tool results up to 256 KiB each in private files under ~/.crew-pocket/context-archive/<role>/<provider>/<conversation>/.

Contents are immutable SHA-256-named blobs; index updates are atomic; archived source results are not overwritten by curation notes. Up to 24 recent results are inspected per finished turn. Oversized, opaque or unrecognized tool output is **not** archived. Archive entries are not guaranteed to cover every tool invocation or provider-internal/opaque item; only an entry actually present in the index is losslessly recallable. Original transcripts and Role Memory are never edited by this module.

The archive can contain private project files, shell output and secret-bearing data. Keep the directory and device private, protect local backups, and do not expose it as a public static asset.

## Provider limitations

- **Codex**: models can propose and recall via dynamic tools. Native thread/compact/start remains the only compaction operation; neither curation notes nor keepIds directly rewrite Codex token history. Codex may not consume the proposed summary as its own compaction input.
- **AGY**: existing checkpoint/safe compact works as before. The post-turn sidecar can capture readable tool outputs, but AGY doesn't have the new model-driven tool catalog in this phase.
- **Claude CLI**: current Pocket provider reports no native compact capability. A proposal cannot invoke unsupported native operations.

## Verification

Run Node syntax checks on lib/context/self-managed.js, lib/mcp/agent-tools.js, lib/mcp/codex-adapter.js, lib/providers/codex.js, server.js and mcp/server.mjs.

Then run:

    node --test test/self-managed-context.test.js test/mcp-codex-integration.test.js

Test with an enabled fresh Codex Role session, complete a tool-heavy milestone, then ask for crew_context_list and crew_context_propose. Observe the next post-turn evaluation; it may defer the requested compact until safety conditions permit. Verify a different Role and a different conversation cannot recall the archived ID. Turn AutoCompact off to roll back without deleting anything.

Do not confuse **archive size reductions or sidecar notes** with reduced native tokens. Only provider-reported before/after token usage is proof of a successful compaction; compare billed cost and prompt-cache hits separately before claiming a saving.
