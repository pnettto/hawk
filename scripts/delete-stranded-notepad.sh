#!/usr/bin/env bash
# Deletes every note left in the legacy day-blob `notes` array
# (["logs", date].notes) through the old DELETE /api/day/notes endpoint.
#
# Run it against a server that still has that endpoint, i.e. BEFORE deploying
# the read-API release (which answers 410 there). The old endpoint snapshots
# each deleted note into its day-notes history, so they stay recoverable.
# Notes already migrated to real notes keep their copy; only the blob entry goes.
#
# Usage: scripts/delete-stranded-notepad.sh [origin] [--yes]
# Password: $HAWK_PASSWORD, else macOS Keychain `pi-hawk-password` (account $USER).
set -euo pipefail

ORIGIN="https://hawk.pnetto.store"
YES=0
for a in "$@"; do
  case "$a" in
    --yes) YES=1 ;;
    *) ORIGIN="$a" ;;
  esac
done
command -v jq >/dev/null || { echo "jq is required (brew install jq)" >&2; exit 1; }

PW="${HAWK_PASSWORD:-$(security find-generic-password -s pi-hawk-password -a "$USER" -w)}"
TOKEN=$(curl -sf "$ORIGIN/api/login" -H 'content-type: application/json' \
  -d "$(jq -n --arg p "$PW" '{password:$p}')" | jq -r .token)
unset PW
[ -n "$TOKEN" ] && [ "$TOKEN" != null ] || { echo "Login failed" >&2; exit 1; }
auth=(-H "authorization: Bearer $TOKEN")

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
curl -sf "${auth[@]}" "$ORIGIN/api/range?start=0000-00-00&end=9999-12-31" > "$TMP/days.json"

jq -r 'to_entries[] | .key as $d | (.value.notes // [])[]
  | [$d, .id, (.title // "" | if . == "" then "(untitled)" else . end),
     (.markdown // "" | gsub("\\s+"; " ") | .[0:60])] | @tsv' "$TMP/days.json" > "$TMP/list.tsv"

COUNT=$(wc -l < "$TMP/list.tsv" | tr -d ' ')
if [ "$COUNT" = 0 ]; then echo "No day-blob notes left."; exit 0; fi
echo "Day-blob notes to delete: $COUNT"
cut -f1,3,4 "$TMP/list.tsv" | column -t -s $'\t'

if [ "$YES" != 1 ]; then
  read -r -p "Delete these $COUNT notes? [y/N] " ans
  [ "$ans" = y ] || [ "$ans" = Y ] || { echo "Nothing deleted."; exit 1; }
fi

FAILED=0
while IFS=$'\t' read -r date id _; do
  code=$(curl -s -o /dev/null -w '%{http_code}' -X DELETE "${auth[@]}" \
    "$ORIGIN/api/day/notes?date=$date&id=$(jq -rn --arg v "$id" '$v|@uri')")
  if [ "$code" = 200 ]; then echo "deleted $date $id"; else echo "FAILED ($code) $date $id" >&2; FAILED=$((FAILED+1)); fi
done < "$TMP/list.tsv"

echo "Done. Failed: $FAILED"
[ "$FAILED" = 0 ]
