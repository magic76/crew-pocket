# Crew Pocket self-debug runtime

This directory is managed by the Android runtime supervisor.

Files:
- `node.log`: stdout/stderr from the embedded Crew Node host.
- `state.json`: current/last runtime state and source fingerprint.

Recovery loop:
1. Embedded Node fails.
2. Android supervisor records the failure and falls back to the Termux host.
3. Embedded Codex can inspect this directory and patch the APK-private workspace.
4. When source files change, the supervisor retries the embedded Node host.
5. If the new host becomes healthy, it takes over port 8000 again.

Do not delete this directory while debugging a runtime failure.
