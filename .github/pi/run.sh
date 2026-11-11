#!/usr/bin/env bash
# Runs pi on the request, then tests + type-check. Failures go back to pi
# (same session) up to MAX_FIXES times.
#
# Env in:  SESSION_ID, PROMPT_FILE, DEEPSEEK_API_KEY, PI_MODEL (optional), MAX_FIXES (optional)
# Out:     $RUNNER_TEMP/pi-summary.md, $RUNNER_TEMP/checks.log
#          GITHUB_OUTPUT status = passed | failed | no-changes
set -uo pipefail

out="${RUNNER_TEMP:-/tmp}"
summary="$out/pi-summary.md"
checks="$out/checks.log"
max_fixes="${MAX_FIXES:-2}"

pi_run() {
  pi --print \
    --provider deepseek --model "${PI_MODEL:-deepseek-v4-pro}" \
    --session-dir "$HOME/.pi-sessions" --session-id "$SESSION_ID" \
    --append-system-prompt .github/pi/system.md \
    "$1" > "$summary"
}

verify() {
  local t c
  {
    echo '$ deno task test'
    deno task test 2>&1; t=$?
    echo
    echo '$ cd app && npm run check'
    (cd app && npm run check) 2>&1; c=$?
  } > "$checks"
  [ "$t" -eq 0 ] && [ "$c" -eq 0 ]
}

set_status() { echo "status=$1" >> "${GITHUB_OUTPUT:-/dev/null}"; echo "status: $1"; }

if ! pi_run "$(cat "$PROMPT_FILE")"; then
  echo "pi exited with an error" >&2
  exit 1
fi

if [ -z "$(git status --porcelain)" ]; then
  set_status no-changes
  exit 0
fi

for ((i = 0; ; i++)); do
  if verify; then
    set_status passed
    exit 0
  fi
  if [ "$i" -ge "$max_fixes" ]; then
    set_status failed
    exit 0
  fi
  echo "checks failed, asking pi to fix (attempt $((i + 1))/$max_fixes)"
  pi_run "Tests or type-check failed after your change. Fix the problems, then reply with the updated PR summary.

\`\`\`
$(tail -c 20000 "$checks")
\`\`\`" || exit 1
done
