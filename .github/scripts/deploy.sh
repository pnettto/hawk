#!/usr/bin/env bash
# Usage:
#   deploy.sh prod                    deploy the Worker `hawk` to prod
#   deploy.sh preview <branch>        create/update the branch's Preview
#   deploy.sh delete-preview <branch> delete the branch's Preview and its data
#
# Expects root npm deps installed (wrangler), CLOUDFLARE_API_TOKEN +
# CLOUDFLARE_ACCOUNT_ID set, and for prod/preview app/dist built. Runs against
# the wrangler.jsonc in the current directory. Writes the URL to GITHUB_OUTPUT
# as `url`.
#
# Each branch gets its own Preview (`wrangler preview`), with its own Durable
# Object data. Branches whose wrangler.jsonc has no `previews` block (made
# before it existed) fall back to the legacy shared Worker `hawk-preview`.
set -euo pipefail

mode="${1:?usage: deploy.sh prod|preview <branch>|delete-preview <branch>}"

# Branch name → Preview name: lowercase, [a-z0-9-] only, short enough to fit
# in a workers.dev hostname label. "pi/issue-16" → "pi-issue-16".
preview_name() {
  local n
  n="$(tr '[:upper:]' '[:lower:]' <<<"$1" | sed -E 's/[^a-z0-9]+/-/g; s/^-+//')"
  n="${n:0:40}"
  n="${n%%-}"
  [ -n "$n" ] || { echo "empty preview name for branch '$1'" >&2; exit 2; }
  echo "$n"
}

out_url() { echo "url=$1" >> "${GITHUB_OUTPUT:-/dev/null}"; }

case "$mode" in
  prod)
    out="$(npx wrangler deploy --env "" 2>&1)"
    echo "$out"
    out_url "$(grep -oE 'https://hawk\.[a-z0-9-]+\.workers\.dev' <<<"$out" | head -1 || true)"
    ;;

  preview)
    branch="${2:?usage: deploy.sh preview <branch>}"
    if ! grep -q '"previews"' wrangler.jsonc; then
      echo "No previews block in this branch's wrangler.jsonc; using the shared hawk-preview Worker."
      out="$(npx wrangler deploy --env preview 2>&1)"
      echo "$out"
      out_url "$(grep -oE 'https://hawk-preview\.[a-z0-9-]+\.workers\.dev' <<<"$out" | head -1 || true)"
      exit 0
    fi
    name="$(preview_name "$branch")"
    json="$(mktemp)"
    # stdout has asset-upload progress lines, then the JSON.
    npx wrangler preview --name "$name" --json >"$json"
    cat "$json"
    url="$(sed -n '/^{/,$p' "$json" | jq -r '.preview.urls[0] // empty' 2>/dev/null || true)"
    [ -n "$url" ] || url="$(grep -oE 'https://[a-z0-9.-]+\.workers\.dev' "$json" | head -1 || true)"
    out_url "$url"
    ;;

  delete-preview)
    branch="${2:?usage: deploy.sh delete-preview <branch>}"
    name="$(preview_name "$branch")"
    npx wrangler preview delete --name "$name" --worker-name hawk --skip-confirmation
    ;;

  *) echo "unknown mode: $mode" >&2; exit 2 ;;
esac
