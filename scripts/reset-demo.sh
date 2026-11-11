#!/bin/bash
# Reset the demo on laptop A to the initial state.
set -euo pipefail

# Deleting oceania.db under a running server makes every later write fail (SQLite READONLY_DBMOVED).
if lsof -nP -iTCP:4100 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Oceania is still running on port 4100. Stop it with Ctrl+C first." >&2
  exit 1
fi

OCEANIA=$(cd "$(dirname "$0")/.." && pwd)
ACME=/Users/tverous/works/acme
SEED=5f45cdcce86374a31c75476e2449cb94cf21d5da
REPO=Tverous/acme-pricing

rm -rf "$OCEANIA"/oceania.db* "$OCEANIA"/oceania.log "$OCEANIA"/.oceania
git -C "$ACME/main" push --force origin "$SEED:main"
for clone in alice main bob; do
  [ -d "$ACME/$clone" ] || continue
  git -C "$ACME/$clone" fetch --quiet
  git -C "$ACME/$clone" reset --quiet --hard origin/main
  git -C "$ACME/$clone" clean -fd --quiet
done
for id in $(gh api "repos/$REPO/issues/1/comments" --paginate --jq '.[] | select(.body | startswith("Decision:")) | .id'); do
  gh api --silent -X DELETE "repos/$REPO/issues/comments/$id"
done
# An agent may close the spec issue when it finishes the work.
if [ "$(gh issue view 1 --repo "$REPO" --json state --jq .state)" = CLOSED ]; then
  gh issue reopen 1 --repo "$REPO" >/dev/null
fi
if [ ! -d "$ACME/bob" ]; then
  echo "Laptop B: cd ~/acme/bob && git fetch && git reset --hard origin/main && git clean -fd"
fi
