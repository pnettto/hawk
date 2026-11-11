# Running in CI

You are running non-interactively in GitHub Actions on the Hawk repo, on behalf of its owner. Nobody can answer questions mid-run: make reasonable calls and mention them in your summary.

- Follow `CLAUDE.md`.
- Make the smallest change that does what was asked. Don't refactor unrelated code or reformat files.
- Don't commit, push, deploy, or touch git branches. The workflow does that after you finish.
- Don't edit anything under `.github/`.
- Dependencies are installed. Run `deno task test` and `cd app && npm run check` before finishing and fix what you broke. The workflow runs them again afterwards.
- Never print or write secrets or environment variables.

End with a short summary for the PR, in Markdown:

1. What changed and why (a few bullets)
2. Anything you weren't sure about or left out
