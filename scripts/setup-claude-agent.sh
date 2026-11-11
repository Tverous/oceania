#!/bin/bash
# Set up Claude Code on another computer as a Tower agent.
# Usage: scripts/setup-claude-agent.sh <member email> <Tower URL> [clone dir]
# Run it after Tailscale, Node 26, gh and Claude Code are ready.
set -euo pipefail
EMAIL=${1:?member email}
URL=${2:?Tower URL, for example https://laptop-a.example.ts.net}
CLONE=${3:-$HOME/acme/bob}
NODE=$(command -v node)
case "$("$NODE" --version)" in v26*) ;; *) echo "Install Node 26 first: brew install node"; exit 1 ;; esac
TOWER=$(cd "$(dirname "$0")/.." && pwd)
[ -d "$CLONE" ] || git clone https://github.com/Tverous/acme-pricing "$CLONE"
git -C "$CLONE" rev-parse refs/remotes/origin/HEAD
CMD="TOWER_URL=$URL TOWER_MEMBER=$EMAIL $NODE $TOWER/src/cli.ts hook --agent claude"
mkdir -p "$CLONE"/.claude
cat > "$CLONE"/.claude/settings.local.json <<JSON
{
  "permissions": {
    "allow": ["Bash(git pull:*)", "Bash(git fetch:*)", "Bash(git rebase:*)", "Bash(git add:*)", "Bash(git commit:*)", "Bash(git push:*)", "Bash(git status:*)", "Bash(git diff:*)", "Bash(git log:*)", "Bash(git stash:*)", "Bash(node src/pricing.ts)", "Bash(gh issue view:*)"]
  },
  "hooks": {
    "SessionStart": [{ "hooks": [{ "type": "command", "command": "$CMD" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "$CMD" }] }],
    "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "$CMD" }] }],
    "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "$CMD" }] }],
    "Stop": [{ "hooks": [{ "type": "command", "command": "$CMD", "timeout": 600 }] }]
  }
}
JSON
grep -qx '.claude/settings.local.json' "$CLONE"/.git/info/exclude || echo '.claude/settings.local.json' >> "$CLONE"/.git/info/exclude
echo "ANTHROPIC_API_KEY set in this shell: $(env | grep -c '^ANTHROPIC_API_KEY=' || true) (must be 0)"
echo "Tower reachable (expect 400): $(curl -s -o /dev/null -w '%{http_code}' -X POST $URL/hook -d x)"
