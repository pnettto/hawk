#!/usr/bin/env bash
# Usage: deploy.sh prod|preview
# CI version of `deno task deploy`. Expects app/dist to be built and
# DENO_DEPLOY_TOKEN to be set. Writes the deployment URL to GITHUB_OUTPUT as `url`.
set -euo pipefail

mode="${1:?usage: deploy.sh prod|preview}"
args=(--org pnettto --app hawk --json --non-interactive)
case "$mode" in
  prod) args+=(--prod) ;;
  preview) ;;
  *) echo "unknown mode: $mode" >&2; exit 2 ;;
esac

# `deno deploy` respects .gitignore (denoland/deploy_feedback#940), so un-ignore
# the Vite build output for the upload and restore the files afterwards.
trap 'git checkout -- .gitignore app/.gitignore' EXIT
sed -i '\|^app/dist$|d' .gitignore
sed -i '\|^dist$|d' app/.gitignore

result="$(deno deploy "${args[@]}")"
echo "$result"

url="$(jq -r '[.. | strings | select(test("^https://[^ ]+\\.deno\\.(net|dev)"))][0] // empty' <<<"$result" || true)"
echo "url=$url" >> "${GITHUB_OUTPUT:-/dev/null}"
