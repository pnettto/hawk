#!/usr/bin/env bash
# Lists notes left in the legacy day-blob `notes` array (["logs", date].notes),
# which current clients no longer read. Read-only: it only logs in and GETs.
#
# A blob note counts as migrated if the schema-2 copy exists in the notes index
# (id `day-<date>` for the legacy "main" note, `day-<date>-<id>` otherwise).
#
# Usage: scripts/list-stranded-notepad.sh [origin]
# Password: $HAWK_PASSWORD, else macOS Keychain `pi-hawk-password` (account $USER).
set -euo pipefail

ORIGIN="${1:-https://hawk.pnetto.store}"
command -v jq >/dev/null || { echo "jq is required (brew install jq)" >&2; exit 1; }

PW="${HAWK_PASSWORD:-$(security find-generic-password -s pi-hawk-password -a "$USER" -w)}"
TOKEN=$(curl -sf "$ORIGIN/api/login" -H 'content-type: application/json' \
  -d "$(jq -n --arg p "$PW" '{password:$p}')" | jq -r .token)
unset PW
[ -n "$TOKEN" ] && [ "$TOKEN" != null ] || { echo "Login failed" >&2; exit 1; }

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
auth=(-H "authorization: Bearer $TOKEN")

curl -sf "${auth[@]}" "$ORIGIN/api/range?start=0000-00-00&end=9999-12-31" > "$TMP/days.json"
curl -sf "${auth[@]}" "$ORIGIN/api/notes/index" > "$TMP/index.json"

jq -r --slurpfile idx "$TMP/index.json" '
  ($idx[0] | map({key: .id, value: true}) | from_entries) as $have
  | [ to_entries[] | .key as $d | (.value.notes // [])[]
      | (if .id == "main" then "day-\($d)" else "day-\($d)-\(.id)" end) as $nid
      | { date: $d, id, migratedAs: $nid, stranded: ($have[$nid] | not),
          title, updatedAt, bytes: (.markdown // "" | utf8bytelength),
          preview: (.markdown // "" | gsub("\\s+"; " ") | .[0:80]) } ]
  | (map(select(.stranded))) as $s
  | "Blob notes: \(length)   already migrated: \(length - ($s|length))   STRANDED: \($s|length)\n",
    ( $s[] | [ .date, .id,
               (if .updatedAt and .updatedAt > 0 then (.updatedAt/1000 | todate) else "-" end),
               "\(.bytes)B", (.title // "" | if . == "" then "(untitled)" else . end), .preview ]
           | @tsv )
' "$TMP/days.json"
