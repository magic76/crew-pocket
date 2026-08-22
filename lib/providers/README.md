# Provider contract

Crew Pocket providers translate a CLI-specific protocol into one shared application contract.
Antigravity is the default provider and must remain available when optional providers fail.

## Required provider shape

Each provider registered in `index.js` exports:

- `id` and `metadata`
- `startTurn(options)`
- `getStatus(conversationId)`
- `stop()`
- `prewarm(model, effort)`

`metadata.capabilities` declares optional features. When a capability is enabled, the registry validates its corresponding method:

- `models`: `listModels()`
- `history`: `listConversations()`, `getHistory()`
- `rename`: `renameConversation()`
- `delete`: `deleteConversation()`
- `rewind`: `rewindConversation()`
- `compact`: `compactConversation()`

Usage can use `{ mode: "endpoint", endpoint }`, `{ mode: "external-link", url }`, or an unsupported mode.

## Normalized turn events

`startTurn()` reports provider-independent events through `onEvent`:

- `session_started`
- `text_delta`
- `reasoning_delta`
- `reasoning_complete`
- `tool`
- `context_usage`
- `error`
- `turn_completed`

## Adding a provider

1. Add one provider module implementing the required methods and metadata.
2. Register it in `index.js`.
3. Implement only the optional methods declared by its capabilities.

The server and frontend discover registered providers through `/api/providers`; provider IDs and UI labels should not be added elsewhere.
