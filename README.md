# Crew Pocket

<div align="center">
  <img src="public/icon-512.png" width="104" alt="Crew Pocket icon">

  **Your personal AI crew, in your pocket.**

  A local-first, role-centric workspace for running and coordinating AI coding assistants from an Android phone.

  [English](README.md) · [繁體中文](README.zh-TW.md)

  [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
  [![Platform: Android + Termux](https://img.shields.io/badge/Platform-Android%20%2B%20Termux-blue.svg)](https://termux.dev/)
  [![Runtime: Node.js](https://img.shields.io/badge/Runtime-Node.js-339933.svg)](https://nodejs.org/)
</div>

![Crew Pocket interface](public/assets/hero_banner.jpg)

## What is Crew Pocket?

Crew Pocket turns CLI-based AI assistants into a **persistent team of Roles**, rather than a collection of disconnected chat windows. Each Role can have a name, instructions, project/workspace, active conversation, memory, and skills. You can switch Roles, continue work, and send a task or message to another Role without copying the sender's entire context.

The main deployment is **an Android APK backed by a Node.js Runtime in Termux**. The APK is a WebView shell for the local interface; it does **not** bundle Node.js or the AI CLI engines. A browser can also open the same local interface for diagnostics, and the optional Remote Console lets a computer access the phone-hosted Runtime over a trusted local network.

> **Project status:** Actively evolving, intended for hands-on use and experimentation. Some features are provider-specific or require device-level setup; do not assume every provider or platform has identical capabilities.

## Highlights

- **Role-first workspace** — independent Role identities, per-Role active conversations, project context, and workspace settings.
- **Multi-agent communication** — Roles can exchange explicit messages in the recipient's current conversation. Delegated task execution and status tracking are available with runtime/provider constraints.
- **Memory & Dreaming** — local persistent memory and configurable, idle-time reflection that can propose memory and Skill candidates. Dreaming uses Codex and requires a working authenticated provider; it is not a free background cloud service.
- **Skill DNA** — Role-scoped reusable skills with candidate, verification, activation, and retirement states. Candidate generation and triggering should not be mistaken for automatically validated agent behavior.
- **Context Health** — context contribution estimates, budget warnings, provenance-aware context assembly, safe compaction planning, and optional AutoCompact signals. Some usage figures are estimates, not exact billing tokens.
- **Tool improvement feedback** — records failure/recovery and tool-use evidence to suggest improvements; proposals are not automatically applied as code changes.
- **Interactive responses** — streaming chat, collapsible execution results, inline HTML/SVG sandboxes, visual reading mode, and allowlisted `crew-ui` choice, checklist, chart, scenario, and calculator widgets.
- **Mobile-first operations** — Android WebView, file access, attachments, optional voice features, and Wireless Debugging tools. Availability varies by provider and Android configuration.
- **Computer companion** — optional Crew Home / Remote Console on the same trusted LAN, with phone-controlled access.

## Supported AI providers

| Provider | Status | Notes |
| --- | --- | --- |
| **Google Antigravity CLI (`agy`)** | Installer default | Resident session integration, conversation history, and supported AGY-specific functionality. |
| **OpenAI Codex CLI (`codex`)** | Optional | Persistent `codex app-server` integration, streaming tool events, models, reasoning, and native context compaction. |
| **Claude Code CLI (`claude`)** | Preview / bring your own CLI | Requires Claude Code installed and authenticated **on the Runtime host**. Not bundled with the Android APK; some functions (including exact context usage and native compact) are unavailable. |

Provider availability, model options, authentication, tool permissions, and costs depend on the installed CLI and your account. Switching providers does **not** transfer native sessions or merge their histories. See [Claude Code provider details](docs/claude-code-provider.md).

## Quick start (Android / Termux)

### 1. Install Termux

Use the official [F-Droid package](https://f-droid.org/en/packages/com.termux/) or [Termux GitHub releases](https://github.com/termux/termux-app/releases).

### 2. Run the installer

Open Termux and run:

```bash
curl -fsSL https://raw.githubusercontent.com/magic76/crew-pocket/main/install.sh | bash
```

The installer installs or checks the minimal Node.js / Git / curl environment, clones or fast-forwards the repository, and lets you select **AGY**, **Codex**, both, or skip provider installation. Its default Termux checkout is `~/agy-web`. Review [install.sh](install.sh) before execution if you prefer to inspect remote scripts.

The automated AGY setup uses its upstream installer; the Android Codex option uses the community-maintained `@mmmbuto/codex-cli-termux` package. These are external dependencies, not binaries shipped by Crew Pocket.

### 3. Authenticate your CLI and start

Sign in to the provider(s) you installed, following their prompts:

```bash
agy             # If using Antigravity: interactive first-time sign-in
codex login     # If using Codex
```

Then:

```bash
crew doctor     # Check basic environment and provider availability
crew start      # Start the local Runtime
```

The interface is served at **http://127.0.0.1:8000**. The intended everyday experience is the Crew Pocket Android APK; opening that address in a browser is useful for testing. `crew start` restarts the Node server, so avoid running it during an active turn.

### 4. Optional: Android APK shell

The APK is **not installed by the Termux installer**. Build or install the Android wrapper separately. For an APK to request that Termux start the Runtime:

```bash
cd ~/agy-web
bash scripts/enable-android-wrapper.sh
```

Then grant the Android **Run commands in Termux environment** permission to Crew Pocket. See [Android wrapper setup, build, and Wireless Debugging](android-wrapper/README.md) for prerequisites, build commands, pairing, and reconnect behavior.

## Daily commands

| Command | Purpose |
| --- | --- |
| `crew doctor` | Check Node.js, checkout, installed providers, storage, and server status. |
| `crew start` | (Re)start the local Runtime. |
| `crew status` / `crew stop` | Inspect or stop the local Runtime. |
| `crew update` | Fast-forward the checkout from `origin/main`; restart Runtime afterward. |
| `crew roles` | List Role IDs for command-line messaging. |
| `crew send <from-role-id> <to-role-id> <message>` | Send an explicit Role-to-Role message through the running Runtime. |

For example:

```bash
crew roles
crew send role-general role-myproject "Review the current build errors."
```

The Role IDs above are illustrative—use IDs returned by `crew roles`. Only the explicit message is sent; the receiving Role continues with **its own** memory, project, workspace, and active conversation.

## How it works

```text
Android APK (WebView) / local browser / optional LAN Remote Console
                            |
                      Node.js Runtime
                            |
       +--------------------+--------------------+
       |                    |                    |
    Role & chat        Context & memory      Task / tool
    orchestration      / Skill DNA           feedback
       |                    |                    |
       +--------------------+--------------------+
                            |
               AGY / Codex / Claude CLI
                  (installed on host)
```

- `server.js` exposes the local HTTP, SSE, and API entry points.
- `lib/` contains providers, Role runtimes, messaging, memory, skills, context management, and task execution.
- `public/` is the web UI served to the Android WebView and browser.
- `android-wrapper/` is the APK shell and Android/Termux bridge.
- `docs/` contains detailed design notes; `test/` and `tests/` contain focused regression coverage.

The original transcripts and Role-specific state are kept locally. Compaction changes the model's working context, **not** the user's historical transcript. The Runtime should be treated as the source of truth; a Remote Console is an access surface, not a second synchronized agent host.

## Updating and developing

```bash
crew update
crew start
```

Changes in `public/`, `server.js`, or `lib/` normally require only a repository update and Runtime restart. Changes to `android-wrapper/`, Android permissions, or native bridges require rebuilding/reinstalling the APK.

Before submitting a change, read [AGENTS.md](AGENTS.md) and [GEMINI.md](GEMINI.md). Run focused tests and syntax checks for the files you modify. Preserve existing conversations and memory across updates.

## Security and limitations

- **Local first:** the default Runtime listens on `127.0.0.1`. Do not expose its API to the public internet. LAN access is an explicit, authenticated Remote Console mode controlled from the phone.
- **AI can execute tools:** understand your provider's approval and sandbox settings before giving it access to sensitive projects, files, or devices. Do not equate an AI-generated result with a verified test or a permission grant.
- **No automatic shared context:** Roles communicate through explicit messages, not by silently sharing private memory or entire transcripts.
- **Not a hosted model service:** you install and authenticate your own CLI providers; the project does not include a paid LLM subscription.
- **Android dependencies:** the APK still requires Termux and its local runtime. Optional ADB quick pairing/reconnect needs Android Wireless Debugging and user authorization. Provider features and physical-device reliability vary.

## Documentation

- [Android wrapper & Wireless Debugging](android-wrapper/README.md)
- [Claude Code preview: setup and limitations](docs/claude-code-provider.md)
- [Interactive response formats and safety boundaries](docs/interactive-replies.md)
- [AI development conventions](AGENTS.md)

## Contributing and license

Issues, bug reports, and focused pull requests are welcome. Please include reproduction steps and the checks you ran, especially for Android WebView, Termux, providers, Role isolation, and conversation persistence.

Licensed under the [MIT License](LICENSE).
