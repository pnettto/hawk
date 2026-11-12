#!/usr/bin/env bash
# Runs pi on the request, then tests + type-check. Failures go back to pi
# (same session, at least high thinking) up to MAX_FIXES times.
#
# The thinking level for the request (off, low, high or max: the levels Flash
# supports) is picked by a quick no-thinking call to the same model.
# PI_THINKING skips that and forces a level.
#
# Env in:  SESSION_ID, PROMPT_FILE, DEEPSEEK_API_KEY,
#          PI_MODEL, PI_THINKING, MAX_FIXES (all optional)
# Out:     $RUNNER_TEMP/pi-summary.md, $RUNNER_TEMP/checks.log
#          GITHUB_OUTPUT status = passed | failed | no-changes
#                        thinking = level(s) used, for the report
set -uo pipefail

out="${RUNNER_TEMP:-/tmp}"
summary="$out/pi-summary.md"
checks="$out/checks.log"
max_fixes="${MAX_FIXES:-2}"
model="${PI_MODEL:-deepseek-flash}"

# Usage: pi_run <thinking level> <prompt>
pi_run() {
  pi --print \
    --provider deepseek --model "$model" --thinking "$1" \
    --session-dir "$HOME/.pi-sessions" --session-id "$SESSION_ID" \
    --append-system-prompt "$(dirname "$0")/system.md" \
    "$2" | tee "$summary"
}

# Prints off, low, high or max. Falls back to high if the call fails or the answer is unclear.
pick_thinking() {
  local answer
  answer="$(timeout 60 pi --print \
    --provider deepseek --model "$model" --thinking off \
    --session-dir "$out/pi-triage" --no-tools --no-context-files --no-extensions --no-skills \
    --system-prompt "You triage requests for a coding agent working on a small Svelte + Cloudflare Workers web app. Reply with one word.
off: trivial, exact edits where the request spells out the change — replacing a given piece of text, a label or a placeholder.
low: small, clear changes — renames, reordering or moving UI elements, removing an element, simple styling, one-file tweaks.
high: new features, changes across several files or the server, bugs to investigate, open-ended or design work, or anything ambiguous.
max: hard problems — data, storage or sync logic, migrations, concurrency, security, or a tricky bug a previous attempt didn't fix.
When unsure between two levels, pick the higher one." \
    "$1" 2>/dev/null | tr '[:upper:]' '[:lower:]' | tr -cd '[:lower:]')"
  case "$answer" in
    off | low | high | max) echo "$answer" ;;
    *) echo high ;;
  esac
}

verify() {
  local t c
  {
    echo '$ npm test'
    npm test 2>&1; t=$?
    echo
    echo '$ npm run check'
    npm run check 2>&1; c=$?
  } > "$checks"
  [ "$t" -eq 0 ] && [ "$c" -eq 0 ]
}

set_status() { echo "status=$1" >> "${GITHUB_OUTPUT:-/dev/null}"; echo "status: $1"; }

thinking="${PI_THINKING:-$(pick_thinking "$(cat "$PROMPT_FILE")")}"
echo "thinking: $thinking"
echo "thinking=$thinking" >> "${GITHUB_OUTPUT:-/dev/null}"
# Fixing failed checks gets at least high thinking.
if [ "$thinking" = max ]; then fix_thinking=max; else fix_thinking=high; fi

if ! pi_run "$thinking" "$(cat "$PROMPT_FILE")"; then
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
  # Later lines win in GITHUB_OUTPUT.
  if [ "$i" -eq 0 ] && [ "$fix_thinking" != "$thinking" ]; then
    echo "thinking=$thinking, $fix_thinking for fixes" >> "${GITHUB_OUTPUT:-/dev/null}"
  fi
  echo "checks failed, asking pi to fix (attempt $((i + 1))/$max_fixes)"
  pi_run "$fix_thinking" "Tests or type-check failed after your change. Fix the problems, then reply with the updated PR summary.

\`\`\`
$(tail -c 20000 "$checks")
\`\`\`" || exit 1
done
