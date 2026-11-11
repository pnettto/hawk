#!/usr/bin/env bash
# Usage: session.sh restore|save
# Keeps pi sessions on the orphan branch `pi-sessions`, one <SESSION_ID>.tgz per
# work branch. (The Actions cache refuses writes from issue/comment events.)
# The repo is public, so these transcripts are too.
#
# Env: SESSION_ID; GH_TOKEN and REPO for save.
set -euo pipefail

branch=pi-sessions
dir="$HOME/.pi-sessions"
file="$SESSION_ID.tgz"
mkdir -p "$dir"

case "${1:?usage: session.sh restore|save}" in
  restore)
    if git fetch -q origin "$branch" 2>/dev/null &&
      git cat-file -e "FETCH_HEAD:$file" 2>/dev/null; then
      git show "FETCH_HEAD:$file" | tar -xzf - -C "$dir"
      echo "restored $file"
    else
      echo "no saved session for $SESSION_ID"
    fi
    ;;
  save)
    [ -n "$(ls -A "$dir")" ] || { echo "nothing to save"; exit 0; }
    tarball="${RUNNER_TEMP:-/tmp}/$file"
    tar -czf "$tarball" -C "$dir" .
    work="${RUNNER_TEMP:-/tmp}/pi-sessions"
    remote="https://x-access-token:$GH_TOKEN@github.com/$REPO.git"
    for attempt in 1 2 3; do
      rm -rf "$work"
      git worktree prune
      if git fetch -q origin "$branch" 2>/dev/null; then
        git worktree add -q --detach "$work" FETCH_HEAD
      else
        git worktree add -q --detach "$work"
        (cd "$work" && git checkout -q --orphan tmp && git rm -rfq .)
      fi
      cp "$tarball" "$work/$file"
      (
        cd "$work"
        git add "$file"
        git diff --cached --quiet && exit 0
        git -c user.name="github-actions[bot]" \
          -c user.email="41898282+github-actions[bot]@users.noreply.github.com" \
          commit -qm "Session $SESSION_ID"
      )
      if git -C "$work" push -q "$remote" "HEAD:refs/heads/$branch"; then
        echo "saved $file"
        exit 0
      fi
      echo "push raced with another run, retrying ($attempt/3)"
      sleep $((attempt * 3))
    done
    exit 1
    ;;
  *) echo "unknown command: $1" >&2; exit 2 ;;
esac
