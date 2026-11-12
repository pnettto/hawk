#!/usr/bin/env bash
# Prints how long this run took and what its LLM calls cost, e.g.
# "Took 3m 12s · LLM cost $0.042 · Thinking: low". Cost is pi's estimate from list prices,
# summed over the assistant messages written since the job started (main
# session plus the thinking-level triage call).
#
# Env: STARTED_AT (epoch seconds, set when the job starts),
#      THINKING (optional, level(s) run.sh used)
set -uo pipefail

secs=$(($(date +%s) - STARTED_AT))
if [ "$secs" -ge 60 ]; then
  took="$((secs / 60))m $((secs % 60))s"
else
  took="${secs}s"
fi

cost="$(
  find "$HOME/.pi-sessions" "${RUNNER_TEMP:-/tmp}/pi-triage" -name '*.jsonl' -type f -print0 2>/dev/null |
    xargs -0 -r cat |
    jq -rs --argjson since "$((STARTED_AT * 1000))" '
      [ .[]
        | select(.type == "message" and .message.role == "assistant" and (.message.timestamp // 0) >= $since)
        | .message.usage.cost.total // 0
      ] | add // 0' 2>/dev/null
)"

line="Took $took"
[ -n "$cost" ] && line="$line · LLM cost \$$(printf '%.3f' "$cost")"
[ -n "${THINKING:-}" ] && line="$line · Thinking: $THINKING"
echo "$line"
