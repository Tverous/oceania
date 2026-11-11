# Oceania: demo video script (115 s)

For c0mpiled-18, the YC Startup School Hackathon in Taipei, 2026-11-11. The theme is the Request for Startups "Multiplayer AI". The video has an English voiceover over one real take recorded on laptop A. There are no slides except one title card and one end card.

## The one-sentence message

Each member keeps their own AI agent on their own computer, and Oceania makes those agents talk to each other and work as a team, so a human is asked only for product decisions.

## Final script

The narration is the exact words to say. Silent rows have no narration. "Feed" means the Oceania feed on laptop A.

| Time (s) | Narration | On screen | Caption |
|---|---|---|---|
| 0–9 | Most engineers now have an AI agent. But each one works alone. Oceania makes these agents work as a team. | **0–2.5:** title card "Oceania". **2.5–9:** laptop A, full screen. The feed is on top, Alice's Copilot CLI is at bottom left, and Bob's Claude Code (an SSH window to laptop B) is at bottom right. The feed prints `Alice's agent (Copilot CLI) joined.` and `Bob's agent (Claude Code) joined.` | — |
| 9–19 | Alice uses GitHub Copilot. Bob uses Claude Code, on a second laptop. Each keeps their own agent and works as usual. | **9–12.5:** push in on the Copilot CLI banner. **12.5–16:** push in on Bob's window. The title bar shows the SSH session to laptop B, and the Claude Code banner is inside it. **16–17.5:** insert of Bob's hook command on laptop B, with `OCEANIA_URL=https://….ts.net` (emails blurred). **17.5–19:** back to the full layout. | Two vendors · two laptops · hooks only |
| 19–31.5 | Round one. Alice adds yearly prices. Bob adds an FAQ. Every tool call reads and writes Oceania's shared memory, so each agent knows the other's task. | Alice's prompt: the last words, then Enter (readable for 1.5 s). Jump cut. Bob's prompt (1.5 s). Then the feed at 8–16×: two `▶ task` lines, and Oceania's status line to each agent with the other agent's task (one line boxed for 1 s). Then `⬆ pushed to main: src/plans.ts`, Bob's terminal running `git pull --rebase` (1 s), and the second `⬆ pushed to main`. | Round 1 · different files · no human |
| 31.5–45.5 | Round two. The spec asks for a Pro plan with a free trial. It does not say how long. Alice says fourteen days, card required. Bob says thirty days, no card. | **31.5–35.5:** GitHub issue #1 by Tverous: "Launch a Pro plan with a free trial. Add the plan and show it on the pricing page." The words "free trial" are highlighted. **35.5–40.5:** at 1×, Alice's prompt ends with "…14-day trial, card required." and Enter. Jump cut. **40.5–45.5:** at 1×, Bob's prompt ends with "…30-day free trial with no card." and Enter. The feed shows both `▶ task` lines. | Round 2 · one spec, read two ways |
| 45.5–56.5 | Oceania's master agent sees the two tasks disagree. The impact is high, so Oceania pauses both agents and asks the spec author in Slack. | A hard cut over the judge round (the feed timestamps jump). Feed at 1×: `⚠ Conflict #… · Before · HIGH impact · Trial terms differ for the Pro plan.` (boxed), then `? asked Tverous in #oceania-1-… · paused Alice's agent, Bob's agent`. Both terminals show "Oceania paused this session." Cut to Slack: the new channel `oceania-1-<id>` with Alice, Bob and Tverous, the question, and the two buttons. | High impact → a human decides |
| 56.5–59.5 | *(silence)* | Slack at 1×. The cursor rests on "30 days, no card", clicks it, and the channel confirms. | The spec author decides |
| 59.5–67 | Thirty days, no card. Oceania writes it on the GitHub issue. Both agents resume with it. | **59.5–62.5:** issue #1, refreshed. The comment "Decision: 30 days, no card. @Tverous decided this in Slack. Oceania recorded this decision." **62.5–67:** both terminals show "Decision on #1 by Tverous: 30 days, no card. Apply this decision." and both agents continue. Alice's agent changes the Pro plan in `src/plans.ts` to a 30-day trial with no card (time-lapse). | Decision saved on issue #1 |
| 67–72.5 | Duplicate work is low impact, so Bob's agent just gets a note. | Feed: `Oceania → Bob ✉ note: Alice's agent already adds the Pro plan. Use her plan data.` (boxed for 1.5 s). Then Bob's terminal shows the same note. | Low impact → just a note |
| 72.5–74 | *(silence)* | Fast feed scroll: the `⬆ pushed to main` lines, then `✓ Conflict … resolved` for the trial terms. This line comes right after the push that puts the decision on main. The duplicate-work conflict resolves too. | Resolved only when main has it |
| 74–82.5 | Round three. Alice shows yearly prices on the page. Bob marks Pro as most popular. Same file, same time. | The two prompts (each readable for about 1.5 s, with a jump cut between them). Then both terminals edit `src/pricing.ts` (time-lapse). | Round 3 · same file, same time |
| 82.5–89 | Oceania blocks Bob's write and sends Alice's diff. His agent builds on her change. | **82.5–86:** at 1×, held. Feed: `⛔ blocked a write to src/pricing.ts · sent Alice's diff` (boxed). Bob's terminal shows the denied edit: "Alice's agent (Copilot CLI) changed src/pricing.ts in their working copy. Their diff is below. … Use their change as the base for your change.", with her diff. **86–89:** time-lapse. Bob's agent edits the file again and adds "Most popular" on top of her change. | Write blocked · her diff sent |
| 89–96 | Then one pushes, and Oceania tells the other to rebase. The agents fix it themselves. | Feed at 8×: `⬆ pushed to main: src/pricing.ts`, then Oceania's rebase message to the other agent (boxed for 1 s). That agent runs `git pull --rebase` and pushes. Then `✓ Conflict … resolved`. | Low impact → the agents fix it |
| 96–101 | The Slack board tracks every conflict until it is resolved. | Slack, Apps → Oceania → Home: two agent rows (task, status, files) and every conflict with its lifecycle line, for example `Before 9:03 PM → During 9:05 PM → After 9:06 PM → Resolved 9:07 PM`. Box the longest line. | (copy the longest real lifecycle line, without the times) |
| 101–104.5 | The page on main has every change. | Browser: `pricing.html` built from main. The Pro card shows "30-day free trial", "no card" and "Most popular", with monthly and yearly prices. A slow scroll goes down to the FAQ. | Built from main |
| 104.5–115 | Today, two agents. Next, a whole team, across time zones. Oceania makes AI multiplayer. | **104.5–108.5:** the whole feed of the take scrolls past very fast (about 12 minutes in 4 s, with a badge for the real speed). **108.5–115:** end card. The last word ends at about 112, and the card holds for about 3 s after it. | — |

### Fallback lines

The fallbacks keep the same beats. Use each one only when the take differs.

| When | Change |
|---|---|
| Laptop B is not ready, and Bob's agent runs on laptop A | **9–19:** "Alice uses GitHub Copilot. Bob uses Claude Code. Each keeps their own agent and works as usual." (17 words.) The caption becomes "Two vendors · hooks only". Drop the SSH title bar and the hook insert. Do not say "over the network": the agent is on the same machine. |
| In round 3, Alice's write is blocked instead of Bob's | **82.5–89:** "Oceania blocks Alice's write and sends Bob's diff. Her agent builds on his change." Row 89–96 names no one, so it stays the same. |
| The duplicate-work conflict shows as a blocked write, not a note | **67–72.5:** "Duplicate work is low impact, so Oceania just sends her diff." (11 words.) |
| The note comes before the click in the take | Move row 67–72.5 before row 56.5–59.5, so events stay in their real order. The narration still reads well. |
| No duplicate-work conflict in the take | Drop row 67–72.5, and give its 5.5 s to the push scroll at 72.5–74. |
| The trial conflict is found at the During stage, not Before | The narration is still true. The feed line and the caption show the real stage. |
| The button text differs (the master agent writes it again each take) | Keep the narration. Tverous reads both buttons and clicks the 30-day, no-card option. Two rehearsals clicked the wrong one. |

## Word count

**229 words** (counted with `wc -w`; the limit is 240). The silences are 56.5–59.5, 72.5–74 and the end-card hold of about 3 s, 7.5 s in all.

| Row | 0–9 | 9–19 | 19–31.5 | 31.5–45.5 | 45.5–56.5 | 59.5–67 | 67–72.5 | 74–82.5 | 82.5–89 | 89–96 | 96–101 | 101–104.5 | 104.5–115 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Words | 20 | 21 | 26 | 31 | 24 | 16 | 12 | 19 | 14 | 15 | 10 | 7 | 14 |
| Words/min | 133 | 126 | 125 | 133 | 131 | 128 | 131 | 134 | 129 | 129 | 120 | 120 | 112 |

- Speech fills about 107.5 s, at about 128 words a minute. That is a calm pace, and no row goes over 134.
- If the narrator reads slower than 120 words a minute, cut in this order:
  1. "Alice adds yearly prices. Bob adds an FAQ." (−8; the prompts are on screen.)
  2. "The agents fix it themselves." (−5; the caption says it.)
  3. "across time zones" (−3).
  4. "in Slack" (−2; Slack is on screen.)

## Shot list

### Laptop A screen layout

Record laptop A's whole screen as one continuous take at 1× (QuickTime: File → New Screen Recording). Every shot in the video comes from this one take. The only exceptions are the title card, the end card, and the hook-command insert, which shows a static file.

| Space | Window | Content |
|---|---|---|
| 1 (main) | Oceania feed, top ~55% | The Oceania server (`npm start` in `/Users/tverous/works/hackathon`). Use a dark theme, 20 pt or larger, about 100 columns. Keep the timestamps visible. |
| 1 | Alice, bottom left | Copilot CLI in `/Users/tverous/works/acme/alice`. Run `/memory off` so it replies in English. |
| 1 | Bob, bottom right | An SSH session to laptop B over Tailscale. Claude Code runs in `~/acme/bob` on laptop B. The title bar or prompt shows laptop B's hostname. |
| 2 | Slack | The conflict channel, `#oceania-activity`, and Apps → Oceania → Home. |
| 3 | Browser and a small terminal | Issue #1, then `pricing.html`. The terminal is in `/Users/tverous/works/acme/main`. |

Switch between the spaces with Ctrl+→ and Ctrl+←. In the edit, each switch becomes a cut.

### Bob's agent on laptop B, operated from laptop A

Bob's agent, its clone and its Claude Code login all live on laptop B. Its hooks run on laptop B and reach Oceania through the tailnet HTTPS URL. Laptop A gives only the screen and keyboard, through SSH. Before the first take:

1. Laptop B is in the same tailnet as laptop A, and laptop A runs `tailscale serve --bg 4100`.
2. On a Mac, turn on System Settings → General → Sharing → Remote Login on laptop B. Then use plain `ssh <user>@<laptop B's tailnet name>`. The Tailscale app for macOS cannot act as a Tailscale SSH server.
3. In the SSH session, run `tmux new -A -s bob`. If the SSH link drops, the same command reattaches to Claude Code.
4. Check that `echo ${ANTHROPIC_API_KEY:-unset}` prints `unset`. Then run `cd ~/acme/bob && claude --permission-mode acceptEdits`. If Claude Code asks you to log in over SSH, the login keychain may be locked: run `security unlock-keychain ~/Library/Keychains/login.keychain-db`, then start it again.
5. The reset step for laptop B (`cd ~/acme/bob && git fetch && git reset --hard origin/main && git clean -fd`) also runs in this SSH window, after `/exit`.
6. The feed must print `Bob's agent (Claude Code) joined.`

### What to capture in each round

| Part | Capture |
|---|---|
| Before round 1 | The `joined.` lines in the feed, and both agent banners. Separately, outside the take, capture a still of Bob's hook command on laptop B (for example `grep OCEANIA_URL .claude/settings.local.json`). Blur the email in it. |
| Round 1 | Type each prompt in full. Wait about 10 s between Alice and Bob. Let the feed show both status lines, both pushes and the rebase. Optional: switch to `#oceania-activity` for 2 s after the pushes. |
| Round 2 | Refresh issue #1 before the prompts. Type both prompts. When the `⚠` line appears, wait until both terminals show "Oceania paused this session". Then switch to Slack. Read both buttons, and only then click the 30-day, no-card option (within 480 s of the pause). Refresh issue #1 for the comment. Back on space 1, let the resume messages, the note, the pushes and `✓ … resolved` play out. |
| Round 3 | Type both prompts. When the `⛔` line appears, do not touch Bob's window, so the deny text and diff stay readable. Let the pushes, the rebase message and `✓ … resolved` play out. |
| End | Wait until the board shows every conflict resolved. Open Apps → Oceania → Home. Then run `cd /Users/tverous/works/acme/main && git pull && node src/pricing.ts && open pricing.html` and scroll slowly to the FAQ. |

## Editing notes

- **Tool.** QuickTime cannot export sped-up clips, so cut in iMovie (or any editor with speed changes and text titles).
- **Real speed (1×).** The last words of each prompt and Enter, the `⚠` HIGH impact line, the paused text in both terminals, the Slack question and the click, the issue comment, the `⛔` line and Bob's deny text, the board, and the page.
- **Hard cuts, not speed-ups.** Every judge-round wait (10–25 s) and the gap of about 10 s between the two prompts of a round. The feed timestamps then jump, which shows real time passing.
- **Speed-ups (8–16×).** Agent coding, test and git output, pushes and rebases, and all of round 1 after the prompts.
- **Speed badge.** A small corner badge, for example "Live take · 8×", is on screen whenever playback is faster than 1×. It shows the real factor.
- **Order.** Events stay in the order of the take. Nothing is re-staged or mocked. Every feed line on screen keeps its real timestamp.
- **Highlights.** A thin box around the key line for 1–1.5 s: the status line in round 1, `⚠`, `✉ note`, `⛔`, the rebase message, and the longest lifecycle line on the board.
- **Captions.** At most six words, in the lower third. They never quote a button label, because the label can differ between takes.
- **Title card (0–2.5 s).** "Oceania" in white on a dark background, with nothing else.
- **End card (108.5–115 s).** "Oceania", then "Multiplayer AI for teams", then a small line: "c0mpiled-18 · YC Startup School Hackathon · Taipei".
- **Voiceover.** Record it after the picture is locked, one row at a time, in a quiet room with the microphone close. If a row runs long, use the cut list above, not a faster read.
- **Privacy.** Blur emails (hook commands, Slack profiles). Never show `.env` or any token.
- **Export.** 1080p, no longer than 1:55.

## Claims check

| Claim | Where | Status | Check in the take |
|---|---|---|---|
| "Most engineers now have an AI agent. But each one works alone." | 0–9 | Framing (the YC Request for Startups), not a product claim | — |
| Oceania makes these agents work as a team | 0–9, 104.5–115 | Built, for two agents in one repo | Status lines, notes, the block and the rebase message all appear |
| Alice uses GitHub Copilot; Bob uses Claude Code | 9–19 | Built: Copilot CLI and Claude Code, connected only through hooks | Both banners |
| Bob's agent is on a second laptop | 9–19 | Built: it reaches Oceania through Tailscale HTTPS. Laptop A is only its screen and keyboard over SSH | The SSH title bar and `joined.`. Otherwise use the fallback line |
| Each keeps their own agent and works as usual | 9–19 | Built: hooks only, and members do not change how they use their agent | — |
| Every tool call reads and writes Oceania's shared memory | 19–31.5 | Built: a live check before a write; after a tool call, the diff is recorded and new events are read | — |
| Each agent knows the other's task | 19–31.5 | Built: status from Oceania | A status line in the feed for each agent |
| The spec does not say how long the trial is | 31.5–45.5 | True of issue #1 (it also does not say whether a card is needed) | The issue on screen |
| Oceania's master agent sees the two tasks disagree | 45.5–56.5 | Built: a judge round (Claude Opus through the Claude Agent SDK) on each new task, diff or push, 10–25 s, about $0.05 | The `⚠` line |
| The impact is high, so Oceania pauses both agents and asks the spec author in Slack | 45.5–56.5 | Built: a conflict channel with an invite and buttons, and both agents paused | The paused text in both terminals, and the Slack channel |
| Oceania writes the decision on the GitHub issue; both agents resume with it | 59.5–67 | Built | The issue comment, and the resume text in both terminals |
| Duplicate work is low impact; Bob's agent gets a note | 67–72.5 | Built | The `✉ note` line. Otherwise use a fallback |
| The trial conflict resolves only when main has the decision (caption) | 72.5–74 | Built: lifecycle tracking and push detection | The push line comes right before `✓ … resolved` |
| Oceania blocks Bob's write and sends Alice's diff | 82.5–89 | Built: the deterministic live check on every file write | The `⛔` line and the deny text |
| His agent builds on her change | 82.5–89 | The agent's own behaviour, prompted by the deny text | Bob's next edit keeps Alice's lines |
| Then one pushes, and Oceania tells the other to rebase; the agents fix it themselves | 89–96 | Built: the After stage, and impact decides who resolves | The rebase message, then the second push |
| The Slack board tracks every conflict until it is resolved | 96–101 | Built: App Home with each agent's task, status and files, and each conflict's lifecycle line | Every conflict shows Resolved |
| The page on main has every change | 101–104.5 | The outcome of the take | Check `pricing.html` from main before recording the voiceover |
| "Today, two agents." | 104.5–115 | Built: exactly two agents were tested live | — |
| "Next, a whole team, across time zones." | 104.5–115 | Vision, marked by "Next" | — |
| "Oceania makes AI multiplayer." | 104.5–115 | Built at two agents; vision at team scale | — |
| Feed line formats in this script | All rows | The format planned for the feed. The edit uses the real lines of the take | Before the first take, check that the feed prints a line for each message: task, status, note, pause, blocked write, push and resolved |

**Not claimed anywhere:** cross-company authentication or tenancy, many repos, more than two agents tested live, cloud deployment, agents of non-engineers.

**Product names said aloud:** GitHub Copilot and Claude Code (the two agents that Oceania connects), and Slack and GitHub (where people see the work). The script compares Oceania with no other product. Tailscale shows only on screen, in the tailnet URL.

## How the three drafts scored

Each criterion is scored from 1 to 5.

| Criterion | Draft 1 (rfs-first) | Draft 2 (cold-open) | Draft 3 (team-story) |
|---|---|---|---|
| Clarity in the first 10 seconds | 4 | 3 | 5 |
| Shows the real product working | 5 | 5 | 5 |
| One story, no detours | 4 | 3 | 5 |
| The aha moment lands early | 2 | 5 | 3 |
| Judges see the agents talk round after round, and the lifecycle | 5 | 4 | 4 |
| Honesty (no vision claimed as built) | 5 | 3 | 5 |
| Oceania's difference, with no other products named | 5 | 5 | 4 |
| Vision ending | 2 | 3 | 5 |
| Timing fits the real beats in 115 s | 4 | 3 | 4 |
| Speakable by a non-native English speaker | 4 | 4 | 4 |
| **Total (of 50)** | **40** | **38** | **44** |

- **Draft 1.** Clear and honest, and it has the best edit rules. But 31 s of setup and mechanism come before the first conflict (at 56 s), and the vision lives only on the end card.
- **Draft 2.** It has the earliest hook. But the cold open shows a later event first, and "from two companies" can be heard as cross-company use, which is not built. Its round 2 row needs about 144 words a minute.
- **Draft 3 wins.** It says the problem and the product in its first two sentences, it tells one story in order through all three rounds, and it is the only draft that ends on a concrete vision clearly marked as "Next".
- **Grafted into the final script.** From Draft 1: the silent click, the "Live take" speed badge, the "Resolved only when main has it" caption, and the hook-command insert. From Draft 2: "Today, two agents. Next, …" before "Oceania makes AI multiplayer", the cut-order list, and keeping Tailscale out of the narration. New in the final: "the spec author" instead of a name listeners may not catch, and a round 3 rebase line that is true whoever pushes first.
