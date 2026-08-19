#!/usr/bin/env bash
# Shared harness detection for PreToolUse hooks that run under Claude Code,
# Kimi Code CLI, and opencode. Mirrors permissions.mjs detectHarness:
#   env CLAUDE_PERMS_HARNESS wins, else stdin JSON shape:
#     transcript_path -> claude, tool_call_id -> kimi. Default claude.
# opencode has no distinctive stdin shape here, so it is env-selected only
# (the opencode bridge plugin always sets CLAUDE_PERMS_HARNESS=opencode).
#
# Usage:
#   source "$(dirname "$0")/lib/harness.sh"
#   input=$(cat)
#   harness=$(detect_harness "$input")   # -> "claude" | "kimi" | "opencode"

detect_harness() {
  local input="$1"
  case "${CLAUDE_PERMS_HARNESS:-}" in
    kimi | kimicode) echo kimi; return ;;
    opencode) echo opencode; return ;;
    claude | claude-code) echo claude; return ;;
  esac
  if printf '%s' "$input" | jq -e 'has("transcript_path")' >/dev/null 2>&1; then
    echo claude; return
  fi
  if printf '%s' "$input" | jq -e 'has("tool_call_id")' >/dev/null 2>&1; then
    echo kimi; return
  fi
  echo claude
}

# Agent display name for a harness ("Claude" | "Kimi" | "opencode").
harness_agent_name() {
  case "$1" in
    kimi) echo Kimi ;;
    opencode) echo opencode ;;
    *) echo Claude ;;
  esac
}

# Project-instructions filename: Claude reads CLAUDE.md; Kimi + opencode read AGENTS.md.
harness_instructions_file() {
  case "$1" in
    kimi | opencode) echo AGENTS.md ;;
    *) echo CLAUDE.md ;;
  esac
}
