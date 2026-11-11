#!/usr/bin/env bash
# Usage: deploy.sh prod|preview
# Deploys the Worker with Wrangler. Expects app/dist to be built, root npm deps
# installed, and CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID set. Writes the
# deployment URL to GITHUB_OUTPUT as `url`.
set -euo pipefail

mode="${1:?usage: deploy.sh prod|preview}"
case "$mode" in
  prod) env_flag=(--env "") ; name=hawk ;;
  preview) env_flag=(--env preview) ; name=hawk-preview ;;
  *) echo "unknown mode: $mode" >&2; exit 2 ;;
esac

out="$(npx wrangler deploy "${env_flag[@]}" 2>&1)"
echo "$out"

url="$(grep -oE "https://${name}\.[a-z0-9-]+\.workers\.dev" <<<"$out" | head -1 || true)"
echo "url=$url" >> "${GITHUB_OUTPUT:-/dev/null}"
