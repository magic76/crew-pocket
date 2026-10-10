# Crew Forge prototype

This directory is the first Crew Forge product prototype. It intentionally reuses the existing Crew Pocket backend instead of adding a second AI service.

## Product loop

1. Describe a mini app.
2. `POST /api/chat` starts or continues one persistent AI conversation for that app.
3. The response must contain one complete `html` fenced block.
4. Crew Forge runs the generated document in a sandboxed iframe.
5. `Modify` reuses the same conversation so the AI edits the existing app instead of starting over.
6. Every accepted output is saved as a local version and can be undone.

## Runtime bridge

Generated apps do not receive same-origin access. Persistent state and small device capabilities are exposed through:

```js
await crew.storage.get(key, fallback)
await crew.storage.set(key, value)
await crew.storage.remove(key)
await crew.storage.all()

await crew.vibrate(pattern)
await crew.share({ title, text, url })
```

State is scoped by Forge app id and survives generated-code revisions.

## Current V0 limitations

- Library metadata and generated HTML are stored in browser `localStorage`.
- There is no cloud sync or export/import yet.
- Runtime APIs currently include storage, vibration, and share only.
- This prototype is served by Crew Pocket at `/forge/`.
- Once the product loop is validated, this directory can be moved into a standalone `crew-forge` repository/app while continuing to use the Crew Pocket backend.
