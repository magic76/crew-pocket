# Claude Code Provider (local-first preview)

Crew Pocket can use an existing Claude Code CLI as a third execution provider, alongside Codex and Antigravity. It reuses the Role, Dreaming, Context Health and conversation endpoints. It is not a managed Claude account or a cloud CLI service.

## Prerequisites

1. Install the official Claude Code CLI **on the same machine that runs the Crew Pocket Node Runtime** and verify its version.
2. Sign in locally in that machine's terminal and verify that non-interactive print mode works.
3. Restart Crew Runtime; the UI discovers the provider only when the executable is present. Select **Claude Code** from the Provider picker.

The current Android package does **not** bundle Claude Code. Termux compatibility and first-class macOS/Linux deployment are separate follow-ups. A Claude CLI installed on your Mac cannot be reached by an Android Runtime merely because its webpage is opened on the Mac.

## Behaviour

- Each Pocket conversation owns its own native Claude session ID. Resume is **explicit**; the adapter never uses "continue the last session", which could attach to unrelated terminal work.
- Pocket metadata and chat history are stored under HOME/.crew-pocket/claude-conversations. Native Claude Code session files stay in the CLI's own configuration.
- Role Memory and Dreaming remain owned by Pocket. Provider switches start a different session; they do not copy another provider's native context.
- Rename and deletion only affect Pocket metadata. Deletion does not erase native Claude Code sessions.
- Streaming text, tool events, native session resume, and stop are supported.
- The model selector exposes rolling Claude aliases: sonnet, opus, and haiku. Actual availability depends on the CLI and the account.
- Low, medium, and high effort map to CLAUDE_CODE_EFFORT_LEVEL where supported.
- Native compact, rewind, image attachments, live voice, login UI, and exact context/token usage are **not supported** in this first version.
- The Runtime uses the workspace as the process cwd. Resuming a conversation in a different workspace is intentionally blocked to prevent cross-project context leaks.

## Security

Default permission mode is default, without bypassing the CLI's own permission checks. Since print mode is non-interactive, some tools requiring user approval may be denied. Configure the CLI's own permissions as needed. Local-only installations may set CREW_CLAUDE_PERMISSION_MODE to acceptEdits, plan, or dontAsk before starting Runtime. Unsafe bypass modes are explicitly rejected.

Do not expose Crew Pocket's local HTTP API to the public internet.

## Verification

Run: node --test tests/claude-provider.test.js

The test uses a simulated CLI and does not require a Claude account.

Manual checks on a machine with authenticated Claude CLI:
1. Start a new Claude Code Role conversation.
2. Refresh and send a second message in the same conversation; verify native resume.
3. Verify Pocket history shows only the user's original words, not injected internal context.
4. Interrupt a long-running turn and verify no false successful completion is shown.
5. Restart the runtime, switch Roles, and confirm histories are isolated.
