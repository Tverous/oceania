# Tower

Tower is a multiplayer mode for the AI coding agents of a team.

Each engineer uses their own agent on their own computer, for example GitHub Copilot CLI or Claude Code. The hooks of each agent read from and write to one shared Memory. A master agent watches the Memory. It finds conflicts between the agents early, and it decides who resolves each conflict:

- **Low impact** (how the code is written): the agents fix the conflict themselves. Tower tells the agent that must change what to do.
- **High impact** (what the product does, or how to read the spec): the spec author decides in Slack. Tower pauses the agents until the decision, then resumes them with it.

## Architecture

```mermaid
flowchart LR
  A["Laptop A: Alice's Copilot CLI"] -->|hook| HA["tower hook"]
  B["Bob's Claude Code"] -->|hook| HB["tower hook"]
  HA -->|HTTP| M[("Memory (node:sqlite)")]
  HB -->|"HTTPS through Tailscale"| M
  M -->|"new events, notes, denies"| HA
  M -->|"new events, notes, denies"| HB
  M -->|"change events"| L["master agent: check loop and judge rounds"]
  L -->|"conflict records and notes"| M
  L -->|"low impact conflicts"| T["Slack #tower-activity"]
  L -->|"high impact conflicts"| S["Slack conflict channel: owners and spec author"]
  M -->|"each change"| U["Slack App Home: status board"]
  L -->|"read the spec, record the decision"| G["GitHub issue"]
```

Tower has three parts:

1. **`tower hook`** (`src/adapter.ts`). Each agent hook runs this command. It reads the hook payload, adds local git data (repo, base commit, diff, latest known main), sends both to Tower, and prints the answer in the format of that agent. It uses only Node built-in modules, so a computer that runs only an agent does not need `npm install`. If Tower is not available, the command prints nothing and exits with code 0, so the agent continues to work.
2. **Tower server** (`src/cli.ts serve`). One Node process keeps the Memory in `tower.db`, receives hook requests on `127.0.0.1:4100`, runs the master agent, connects to Slack in Socket Mode, and uses the `gh` CLI for GitHub.
3. **Master agent** (`src/master.ts`, `src/judge.ts`). Each new task, diff, or push starts one judge round. A judge round uses the Claude Agent SDK with Claude Opus and these tools: `read_memory`, `get_spec`, `track_conflict`, `notify`, `post_activity`, `escalate`, `check_merge`, `run_in_worktree`. Every 60 seconds, the master agent also runs a deterministic check. When a working session has no event for 10 minutes, Tower adds one `stall` event: `<who> may be stalled.` A new event from that session ends the stall. A `stall` event does not start a judge round, but the next round gets it.

## Conflict lifecycle

Memory keeps one record for each conflict, from discovery to resolution. The stage of a conflict is where its changes are:

| Stage | Where the changes are | How Tower finds it |
|---|---|---|
| Before: tasks conflict | Only the tasks conflict. | The master agent compares tasks, diffs, the spec, and decisions. |
| During: changes not on main | In the diff of a session. | The live check on each file write, and the master agent. |
| After: changes on main | On main. | Push detection, and the master agent. |

- **Live check.** Before each file write, Tower checks the path against the diffs of the other sessions in the same repo. If another session changed the file, and this session did not see that diff version, Tower denies the write and sends the other diff. The session that changed the file first has priority.
- **Push detection.** After each tool call, the hook reports the latest known main of the clone. When main changes and files leave the diff of the session, Tower records a push. A pull does not remove files from the diff, so a pull is not a push.
- **Merge check.** Tower keeps a bare clone of the repo in `.tower/repo` (not in git). It clones `https://<repo>.git` when the first session reports git data. After each tool call, Tower updates the shadow ref `refs/tower/<session>` in the background: a commit with the session diff on top of the base commit of the session. The `check_merge` tool runs `git merge-tree --write-tree` on the shadow refs of two sessions and returns the files that conflict. No work tree changes.
- **Test check.** The `run_in_worktree` tool merges the shadow refs of two sessions in the same way. If the merge has no conflicts, Tower checks out the merged tree in a temporary `git worktree` and runs `npm test` there. Thus the master agent can find a change in one diff that breaks the code in the other diff. The tool returns the test output (at most 9,000 bytes) when the tests fail. Tower stops the tests after 60 seconds and always removes the temporary worktree. If `package.json` has no `test` script, Tower does not run tests. Tower does not run `npm install` in the worktree. The tests run the code of the agents on the Tower computer, and they do not get the Slack and Anthropic secrets from `.env`.
- **Each round,** the master agent checks each open conflict again. It updates the stage and the impact, takes the next action, or marks the conflict resolved. A decision stays open until main has it.

## Requirements

- Node 26 (Tower runs the TypeScript files directly).
- `gh`, signed in to GitHub.
- Git 2.38 or later, for `git merge-tree --write-tree`. Git on the Tower computer must be able to clone the repo over HTTPS. For a private repo, run `gh auth setup-git`.
- A Slack workspace with the Tower app. Create the app from `slack-manifest.json`, install it, and create an app-level token with the `connections:write` scope.
- An Anthropic API key for the master agent only. Do not set `ANTHROPIC_API_KEY` in the shell that runs Claude Code.
- Tailscale, if an agent runs on a different computer.

## Set up and run

```bash
npm install
npm test          # unit tests; the judge smoke test runs only with ANTHROPIC_API_KEY
npm run check     # tsc --noEmit
npm start         # node --env-file=.env src/cli.ts serve
```

`.env` (not in git):

```text
ANTHROPIC_API_KEY=...
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
TOWER_REPO=<owner>/<repo with the spec issues>
```

`members.json` (not in git). `email` is the Slack email of the member. `github` connects a spec author to their GitHub account.

```json
[
  { "name": "Tverous", "email": "tverous@example.com", "github": "Tverous" },
  { "name": "Alice", "email": "alice@example.com" },
  { "name": "Bob", "email": "bob@example.com" }
]
```

## Hook settings

Each clone has its own hook file. Add the file path to `.git/info/exclude` of that clone. `TOWER_MEMBER` is the email of the owner. Use the absolute path of `node` (`command -v node`).

**Copilot CLI**: `<clone>/.github/hooks/tower.json`. Use PascalCase event names. Copilot loads repo hooks only from a trusted folder, so add the clone to `trustedFolders` in `~/.copilot/config.json`.

```json
{
  "version": 1,
  "hooks": {
    "SessionStart":     [{ "type": "command", "bash": "<command> --agent copilot", "timeoutSec": 30 }],
    "UserPromptSubmit": [{ "type": "command", "bash": "<command> --agent copilot", "timeoutSec": 30 }],
    "PreToolUse":       [{ "type": "command", "bash": "<command> --agent copilot", "timeoutSec": 30 }],
    "PostToolUse":      [{ "type": "command", "bash": "<command> --agent copilot", "timeoutSec": 30 }],
    "Stop":             [{ "type": "command", "bash": "<command> --agent copilot", "timeoutSec": 600 }]
  }
}
```

**Claude Code**: `<clone>/.claude/settings.local.json`.

```json
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "<command> --agent claude" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "<command> --agent claude" }] }],
    "PreToolUse":       [{ "matcher": "*", "hooks": [{ "type": "command", "command": "<command> --agent claude" }] }],
    "PostToolUse":      [{ "matcher": "*", "hooks": [{ "type": "command", "command": "<command> --agent claude" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "<command> --agent claude", "timeout": 600 }] }]
  }
}
```

`<command>` is:

```text
TOWER_MEMBER=<email> TOWER_URL=<Tower URL> /absolute/path/to/node /absolute/path/to/tower/src/cli.ts hook
```

`TOWER_URL` is `http://127.0.0.1:4100` (the default) on the computer that runs Tower.

The `Stop` timeout is 600 seconds. A paused agent waits in its `Stop` hook for the decision: up to 90 seconds for the running judge round, then up to 480 seconds for the decision.

## Agents on other computers

The Tower server listens only on `127.0.0.1`, because the MVP has no authentication. To let an agent on another computer connect, the computer that runs Tower shares the port in its tailnet:

```bash
tailscale serve --bg 4100
```

The other computer sets `TOWER_URL` to the tailnet HTTPS URL, for example `https://laptop-a.example.ts.net`. Only devices in the tailnet (or devices that you share the machine with) can connect. The other computer needs only Node, its agent, and a clone of this repo for `tower hook`.

## Demo

The demo repo has `src/plans.ts` (the plans), `src/pricing.ts` (writes `pricing.html`), and `AGENTS.md` (pull first, commit and push when done, rebase before push). Issue #1 says: "Launch a Pro plan with a free trial. Add the plan and show it on the pricing page." It does not say the trial length or if a card is necessary.

1. Alice (Copilot CLI): `Add the Pro plan from #1 to src/plans.ts: 14-day trial, card required.`
2. About 10 seconds later, Bob (Claude Code): `Show the Pro plan from #1 on the pricing page. Use a 30-day free trial with no card.`
3. **Conflict A (high impact).** The tasks disagree on the trial terms, and the spec does not say them. Tower opens a Slack conflict channel with the question and the options, and pauses both agents.
4. The spec author clicks "30 days, no card". Tower records the decision on issue #1 and resumes both agents with it.
5. **Conflict B (low impact, during).** Bob's agent tries to add the Pro plan to `src/plans.ts` too. The live check denies the write and sends Alice's diff. Bob's agent changes only `src/pricing.ts`. The master agent posts a summary in `#tower-activity`.
6. **Conflict B (after).** Alice's agent pushes. Tower detects the push. The master agent tells Bob's agent to rebase on main before it pushes. Bob's agent pushes, and both conflicts become resolved.
7. The App Home board shows both sessions and both conflicts. `node src/pricing.ts` on main shows the Pro plan with a 30-day trial and no card.

`scripts/reset-demo.sh` resets the demo clones, the Memory, and the decision comments.

## Limitations

- No authentication. Tower listens only on `127.0.0.1`. Use `tailscale serve` to reach it from other devices in your tailnet.
- Tower cannot wake an idle agent. An idle agent gets its updates at its next tool call.
- Only agents with hooks are supported (Copilot CLI and Claude Code).
