---
name: gh-pr-watch
description: background process to wait for PR checks to pass; flags merge conflicts against the base branch
argument-hint: "[pr-number-or-url]"
arguments: [pr]
model: haiku
effort: low
context: fork
---

Run `gh-pr-watch.sh $pr` (installed in `~/.local/bin`) with the Bash tool. If no PR argument was given, run it with no arguments; it defaults to the PR for the current branch. Do NOT replace it with a direct `gh pr checks` call and do NOT build your own polling loop around it: the script already blocks until CI finishes.

The script's exit code is the verdict. Never parse its stdout (or raw `gh pr checks` output) for "pass"/"fail" strings:

- exit 0: all checks passed
- exit 1: a check failed (failure log and its path are on stderr)
- exit 2: the PR has merge conflicts with its base branch; stop watching and resolve conflicts first

CI can take 10+ minutes. Use `run_in_background` if Bash timeout is a concern and read its output file on completion; do not restructure the script into a poller to dodge the timeout.

After it completes, report the stdout and exit code to the caller verbatim. Do not paraphrase, summarize, or decorate with bullet points or markdown.
