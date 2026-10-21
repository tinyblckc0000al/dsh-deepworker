# DeepWorker

A conversation-workflow extension for DSH (DeepSeek Harness). It turns repeated manual steps in long conversations into single actions in the existing UI, without rewriting the session log or replacing native workflows.

## The gap it addresses

DSH already provides sessions, branching (fork), global search, terminals, and `@` references. DeepWorker does not duplicate those primitives; it adds the **composed actions** that the native UI does not expose as one step:

- **Redo a specific turn**: native flows require locating the turn, forking, and resending; DeepWorker puts retry and branch at the turn end, and edit-and-resend under the user bubble.
- **Quote with provenance**: native `@` references point at a session or file; DeepWorker adds selected-text quotes anchored to “turn N / seq M”, with a jump back to the source.
- **Keep conclusions outside the conversation**: DSH has no standalone notes page; DeepWorker adds local notes with tags, search, and export/import.
- **Condense a long conversation**: there is no native “summarize into a note” action; DeepWorker offers a local deterministic digest and an optional model summary.
- **Locate a line in a loaded conversation**: native global search returns sessions and snippets; DeepWorker highlights matches inside the loaded conversation and jumps to the turn.
- **Hold a single context**: DSH has no session-level focus mode; DeepWorker adds session/workspace focus locks.
- **Operate several projects/services**: native terminals require opening a terminal, `cd`, and typing the command each time; DeepWorker keeps per-workspace start/stop/extra commands in the session header, with batch runs and pre-command sequences.

## Screens

![DeepWorker capability overview](https://raw.githubusercontent.com/tinyblckc0000al/dsh-deepworker/main/docs/assets/ad-overview.png)

*Eight capabilities: turn actions, quotes, notes, digests, find, focus lock, multi-workspace commands, local-first.*

![Conversation workflow](https://raw.githubusercontent.com/tinyblckc0000al/dsh-deepworker/main/docs/assets/ad-conversation.png)

*Turn actions, quote anchors, and the notes card.*

![Focus lock](https://raw.githubusercontent.com/tinyblckc0000al/dsh-deepworker/main/docs/assets/ad-focus-lock.png)

*Session/workspace focus lock; non-target workspaces dim, with an unlock path.*

![Multi-workspace command buttons](https://raw.githubusercontent.com/tinyblckc0000al/dsh-deepworker/main/docs/assets/ad-command-buttons.png)

*Real UI: workspace table, batch operations, and output logs.*

![New workspace dialog](https://raw.githubusercontent.com/tinyblckc0000al/dsh-deepworker/main/docs/assets/ad-new-workspace.png)

*Real UI: path, start, stop, extra buttons and timeout in one dialog.*

![Pre-start sequence](https://raw.githubusercontent.com/tinyblckc0000al/dsh-deepworker/main/docs/assets/ad-pre-sequences.png)

*Real UI: ordered pre-start actions. Paths and project names are redacted.*

## Core capabilities

| Capability | What it does | Why it matters |
|---|---|---|
| **Turn actions** | Four actions at the turn end: quote reply, retry, branch here, new chat with mode; edit & resend sits under the user bubble | Collapses fork / prompt / archive steps into one click; history remains append-only |
| **Quotes with provenance** | Writes the selection as a quote block with a “turn N · seq M” anchor; clicking the anchor returns to the source turn and highlights it | Quotes stay traceable in long conversations |
| **Standalone notes** | Opens from the sidebar foot; Markdown, tags, search, edit-and-resave, copy/delete, JSON or plain-text import/export | Turns conclusions into searchable local knowledge |
| **Two capture paths** | Right-click selected text → save as note; notes page → save clipboard as note | Saves without leaving the current input flow |
| **Summarize into a note** | Deterministic digest by default (local, free, reproducible); optional model summary in a temporary session that is archived afterwards | Produces a readable record quickly; model use is opt-in |
| **Find in conversation** | Search the loaded conversation, highlight matches, jump to the turn | Closer to “find a line in the conversation I am reading” than global search |
| **Focus lock** | Locks the current session or its workspace; all session-switching entry points are intercepted; non-target workspaces dim | Keeps one context active and prevents accidental switches |
| **Multi-workspace command buttons** | Per-workspace start/stop/extra buttons; serial batch runs; per-button pre-command sequences; agent-editable JSON | Removes repeated terminal setup for routine service operations |
| **Output logs** | Recent output in settings by default; optional per-workspace `.dsh-deepworker/logs/` files | Start failures, service state, and occasional output remain reviewable |
| **Header buttons** | Choose which actions appear in the session header per workspace, and in what order; all by default | Keep only the buttons that workspace actually needs |
| **Version check** | Manual npm check at the bottom of settings; no network by default; release-page and repository links stay visible on success or failure | No automatic install; the upgrade decision stays with the user |
| **Feature switches** | Eight capabilities can be introduced/removed independently; the basic tab has a master switch; disabled items stay visible with a reason | Enable only what you need; the basic tab always keeps a recovery path |
| **Visible failure** | Failed writes, empty commands, permission errors, and unwritable log directories are reported explicitly | Avoids silent “I clicked and nothing happened” failures |

## Design highlights

- **History is never rewritten**: edit & resend, retry, and branch use DSH's native fork / surface replace; the session log stays append-only.
- **Service-level session interception**: focus lock is not a DOM overlay; it wraps the five `ctx.uiWorkspace` switching methods that sidebar rows, search results, subagents, the task panel, forks, and new-session flows all converge on.
- **Client-side implementation**: the host half is an empty `apply`; the functionality runs in the renderer and needs no new host service, remote, or shared package.
- **Individually switchable features**: eight capabilities can be introduced or removed independently; a master switch turns them all off; disabled items remain visible with a reason, and the basic tab is always the recovery path.
- **Agent-editable configuration**: command buttons accept a workspace JSON file; each extra button can own a pre-command sequence; an agent writes the file and the user clicks “Load now”.
- **Local first**: notes, settings, and recent output stay on this machine; session logs are never read or written; model summaries and file logs are explicit opt-ins.
- **Visible, testable failure**: registration failures are isolated and reported; empty commands, permission errors, and unwritable log directories fail loudly; the gate includes SSR, real-DOM, data/executor, and mutation tests.

## Typical use cases

### 1. Long debugging sessions: redo from the failure point

A debugging session often spans several failed turns. DeepWorker lets you retry at the target turn, branch from it, or edit the original prompt and resend; the original history stays intact and the new branch advances independently.

### 2. Architecture/design discussions: retain the conclusions

Select key passages and save them as notes. At the end of the discussion, generate a structured note with the deterministic digest or the model summary; search, tag, or export it later.

### 3. Multi-service projects: operate services from the session header

Configure start, stop, and extra actions (restart, status, logs) per project; select several workspaces and start them serially; attach a pre-command sequence to an individual button when needed (for example, stop before restart).

### 4. Reading and research: quote, mark, revisit

While reading a long conversation or source material, quote passages with provenance, jump back to verify, and save important conclusions to the notes page.

### 5. Deep work: lock the current session

When you need to stay on one task, lock the current session or workspace; other sessions cannot be opened from the sidebar and non-target workspaces dim.

## Relationship to native DSH

- **Additive, not a replacement**: all entry points live in existing DSH surfaces (session header, under each turn, sidebar, settings).
- **No session-log rewriting**: edit & resend, retry, and branch use DSH's native fork / surface replace; the log remains append-only.
- **Client-side implementation**: the host half is an empty `apply`; functionality runs in the renderer and requires no additional host service or shared package.
- **Unofficial API boundary**: the focus lock wraps five `ctx.uiWorkspace` switching methods; if a future DSH rename breaks them, the plugin reports the failure in its self-check instead of pretending to work.

## Install

### From npm (recommended)

In DSH **Settings → Plugins**, install from the registry:

```text
dsh-deepworker@0.1.5
```

Or have the agent call `plugin_manager`:

```text
install_bundle  target = dsh-deepworker@0.1.5
```

The manager writes it into the profile's `dsh.profile.bundles` and checks the compatibility range.

### Local development

```bash
cd ~/.dsh/plugins/dsh-deepworker
npm install
```

Wire the directory into your current profile, then restart DSH.

## Quick start

| Location | Actions |
|---|---|
| Session header | Command buttons, find, summarize, focus lock |
| Under each turn | Quote reply / retry / branch here / new chat with mode |
| Under the user bubble | Edit & resend |
| Sidebar foot | Notes page |
| Right-click selected text | Quote, save as note |
| Settings → DeepWorker | Feature switches, focus lock, notes, session actions, command buttons |

## Compatibility and data boundaries

- **Compatibility**: `engines.dsh = >=0.2.1-rc.1 <0.3.0`.
- **Local first**: settings, notes, and recent output are stored in this machine's browser storage; the plugin does not read or write session logs.
- **Model summary**: only an explicit “let a model summarize” creates a temporary session and consumes tokens; the deterministic digest is fully local.
- **Command output**: recent output is kept locally; each workspace can opt into file logs. Logs may contain secrets and do not rotate automatically.
- **UI-only settings**: this client plugin has no configuration file. For agent bulk configuration, use the JSON file entry on the command buttons page.

## Verification

```bash
node tools/ha-core/verify/prepublish.mjs
```

The criterion is `failed = 0`. Suites include SSR structure checks, real DOM interaction (jsdom), data/executor tests, and mutation tests.

## Documentation

- Command-button JSON schema: [`docs/command-buttons-config.md`](docs/command-buttons-config.md)
- Changelog: `CHANGELOG.md`
- 中文: [`README.md`](README.md)

## License

[MIT](LICENSE) © 2026 pandamustard
