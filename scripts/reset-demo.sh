#!/bin/bash
# Reset the demo on laptop A to the initial state.
set -euo pipefail

TOWER=$(cd "$(dirname "$0")/.." && pwd)
ACME=/Users/tverous/works/acme
SEED=5f45cdcce86374a31c75476e2449cb94cf21d5da
REPO=Tverous/acme-pricing

rm -rf "$TOWER"/tower.db* "$TOWER"/.tower
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
if [ ! -d "$ACME/bob" ]; then
  echo "Laptop B: cd ~/acme/bob && git fetch && git reset --hard origin/main && git clean -fd"
fi
