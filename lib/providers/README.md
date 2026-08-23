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

### Deletion lifecycle

Providers that declare `delete: true` must make `deleteConversation(conversationId)` a real deletion, not only hide a row from the UI:

1. Reject deletion while that provider's conversation is actively generating, or stop it safely first.
2. Delete the conversation through the underlying CLI/service.
3. Remove only the provider-owned local persisted data for that conversation, including session/log files and in-memory caches.
4. Never delete the user's project files or shared uploads as part of conversation deletion.

The method returns `{ localDataDeleted, storageFreedBytes }`. `storageFreedBytes` is the byte count when the provider can determine it; otherwise it is `null`.

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
