# Crew Pocket MCP — P0 (opt-in)

A **stdio MCP server** for a **single, trusted Role**. It reuses the existing
Crew Pocket Role, Memory and Crew Message stores. No extra runtime, service
port, Android APK or change to `server.js` is required.

## Install and run

Requires Node.js 20+ on the same filesystem as the Crew Pocket data.

```sh
npm install --prefix mcp --omit=dev
CREW_MCP_ROLE_ID=role-general node mcp/server.mjs
```

The process waits on stdin for an MCP client; launching it in a shell by itself
does not produce a chat UI. Use the MCP client/inspector to verify
`tools/list` and `tools/call`. All normal logs go to stderr.

To connect a dedicated, Role-specific Codex CLI session, configure an stdio MCP
server using a fully qualified path to `mcp/server.mjs`, command `node`, and
the environment variable `CREW_MCP_ROLE_ID` set by the trusted launch
configuration for **that particular** Role. Example TOML for a **dedicated**
Codex home/profile (replace paths):

```toml
[mcp_servers.crew_pocket]
command = "node"
args = ["/absolute/path/to/crew-pocket/mcp/server.mjs"]

[mcp_servers.crew_pocket.env]
CREW_MCP_ROLE_ID = "role-general"
```

Do **not** install this single-Role config globally in Crew Pocket's currently
shared multi-Thread Codex App Server. Codex's MCP host configuration is
process-scoped and an MCP call doesn't prove which Codex Thread made it.
Per-Role App Server instances or a verified per-Thread identity mechanism are
required **before** enabling this MCP automatically for Pocket conversations.

## Tools

- `crew_whoami`: own Role, Project and current Runtime pointer
- `crew_list_roles`: public discovery only
- `crew_get_inbox`: own pending Inbox, read-only
- `crew_send_message`: append a plain-text Crew message (queued; **not** automatically executed)
- `crew_recall`: bounded memory search, only own Role/Project/Session plus Global
- `crew_propose_memory`: staged candidate with source references, **not** admitted to canonical Memory

Candidate records live in `~/.crew-pocket/memory/mcp-candidates.json`
(or `CREW_MCP_MEMORY_CANDIDATES_PATH`); P0 intentionally has no automatic
admission to Memory. Keep this file private and back it up with Role data.

## Security boundaries and limitations

- Tool arguments **never choose the caller's role**. The Role is bound when
  the stdio process launches. A deleted Role fails closed.
- A Role cannot recall another Role's ROLE memories. Project-scoped memories
  are available only for the Role's configured Project; Global memories are
  intentionally shared.
- A local process under the same OS user could modify environment variables
  or access Pocket's storage directly. **This is an identity-binding guard
  against accidental cross-Role calls, not an OS-enforced sandbox.** Never
  expose the stdio server to untrusted remote clients.
- Sending a message only persists it. Existing Pocket auto-response is a
  separate server-side workflow; it is *not* run from this MCP server.
- No `roleId`, `fromRoleId`, or memory scope parameter is exposed to the model.
- No arbitrary shell, file edits, memory deletion, role deletion, global
  broadcast or device permission APIs.
- Opt-in installation; no changes to legacy `/api/chat`, role history, or
  installed Codex configuration.

## Verification

```sh
node --check lib/mcp/agent-tools.js
node --check lib/mcp/memory-candidates.js
node --check mcp/server.mjs
node --test test/
```

With SDK dependencies installed, use a dedicated MCP Inspector client to
check handshake / tool listing and call `crew_whoami`, `crew_recall`, and
`crew_send_message` using a temporary test Role.
