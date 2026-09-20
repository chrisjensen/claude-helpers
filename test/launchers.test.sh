#!/usr/bin/env bash
# Checks the exit-note behaviour of the bin/ launchers: on exit they print their
# own name to stderr (a reminder of which command started the session), except in
# script/non-interactive use. Run: bash test/launchers.test.sh
#
# Real launchers, stubbed downstream: a fake `claude`/`headroom`/`opencode` on
# PATH just exits, so no model is called. A pseudo-tty (util-linux `script`) makes
# stdout a terminal to exercise the interactive path; a plain pipe exercises the
# script path.
set -u
BIN="$(cd "$(dirname "$0")/../bin" && pwd)"

fail=0
check() { # check <label> <expected-substring|!absent> <actual>
  case "$2" in
    '!'*) # must NOT contain
      if printf '%s' "$3" | grep -qF -- "${2#!}"; then
        echo "FAIL - $1: did not expect '${2#!}' in output:"; printf '%s\n' "$3"; fail=1
      else echo "ok   - $1"; fi ;;
    *) # must contain
      if printf '%s' "$3" | grep -qF -- "$2"; then echo "ok   - $1"
      else echo "FAIL - $1: expected '$2' in output:"; printf '%s\n' "$3"; fail=1; fi ;;
  esac
}

# --- stub environment ---------------------------------------------------------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
STUBBIN="$TMP/bin"
mkdir -p "$STUBBIN"
for tool in claude opencode; do
  printf '#!/usr/bin/env bash\necho STUB_%s_RAN\nexit "${STUB_EXIT:-0}"\n' "$tool" > "$STUBBIN/$tool"
  chmod +x "$STUBBIN/$tool"
done
# Richer claude stub for model/context assertions: echoes the launcher-selected
# model (--model <m>) and the context env vars so tests can inspect the mapping.
STUBCLAUDE_MODEL="$(cat <<'EOF'
#!/usr/bin/env bash
echo STUB_claude_RAN
model=""; while [ $# -gt 0 ]; do [ "$1" = "--model" ] && { model="$2"; shift; }; shift; done
echo "MODEL=$model"
echo "HEADERS=$ANTHROPIC_CUSTOM_HEADERS"
echo "CTX=$CLAUDE_CODE_MAX_CONTEXT_TOKENS AUTOCOMPACT=$CLAUDE_CODE_AUTO_COMPACT_WINDOW"
exit "${STUB_EXIT:-0}"
EOF
)"
# headroom wrap claude ... -> just run the trailing claude stub.
printf '#!/usr/bin/env bash\nshift 2 2>/dev/null; exec claude "$@"\n' > "$STUBBIN/headroom"
chmod +x "$STUBBIN/headroom"

# opencode family overlay hopencode expects (HOME-scoped), + charter. The
# charter is the repo's own resources/zclaude-charter.md (deployed to ~/.claude
# by install.mjs) so the zclaude runs below exercise the real content.
REPO_CHARTER="$BIN/../resources/zclaude-charter.md"
FAKEHOME="$TMP/home"
mkdir -p "$FAKEHOME/.config/opencode/families" "$FAKEHOME/.claude"
echo '{}' > "$FAKEHOME/.config/opencode/families/kimi.json"
if [ -s "$REPO_CHARTER" ]; then
  cp "$REPO_CHARTER" "$FAKEHOME/.claude/zclaude-charter.md"
else
  echo "FAIL - zclaude charter missing/empty in repo: $REPO_CHARTER"; fail=1
  echo 'charter' > "$FAKEHOME/.claude/zclaude-charter.md"
fi

run_pty()  { HOME="$FAKEHOME" PATH="$STUBBIN:$BIN:$PATH" script -qec "$*" /dev/null 2>&1; }
run_pipe() { HOME="$FAKEHOME" PATH="$STUBBIN:$BIN:$PATH" bash -c "$* 2>&1" </dev/null; }

# --- claude launcher: zclaude -------------------------------------------------
out="$(run_pty zclaude)"
check "zclaude interactive: ran claude" STUB_claude_RAN "$out"
check "zclaude interactive: prints name" zclaude "$out"

out="$(run_pty 'zclaude -p hi')"
check "zclaude -p: ran claude"        STUB_claude_RAN "$out"
check "zclaude -p: name suppressed"   '!zclaude'      "$out"

out="$(run_pty 'zclaude --print hi')"
check "zclaude --print: name suppressed" '!zclaude'   "$out"

# --- exit-code passthrough (the reason exec was dropped) -----------------------
status=0; run_pipe 'zclaude' >/dev/null 2>&1 || status=$?
check "zclaude exit 0 passthrough" 0 "$status"
status=0; STUB_EXIT=4 run_pipe 'zclaude' >/dev/null 2>&1 || status=$?
check "zclaude exit 4 passthrough" 4 "$status"
status=0; STUB_EXIT=9 run_pty 'kopencode' >/dev/null 2>&1 || status=$?
check "kopencode exit 9 passthrough (set -eu core)" 9 "$status"

out="$(run_pipe 'zclaude | cat')"
check "zclaude piped: ran claude"      STUB_claude_RAN "$out"
check "zclaude piped: name suppressed" '!zclaude'      "$out"

# --- headclaude (headroom wrap) -----------------------------------------------
out="$(run_pty headclaude)"
check "headclaude interactive: ran claude" STUB_claude_RAN "$out"
check "headclaude interactive: prints name" headclaude "$out"

# --- opencode wrapper: kopencode shows its own name, not hopencode ------------
out="$(run_pty kopencode)"
check "kopencode interactive: ran opencode" STUB_opencode_RAN "$out"
check "kopencode interactive: prints wrapper name" kopencode "$out"
check "kopencode interactive: not core name" '!hopencode' "$out"

out="$(run_pipe 'kopencode | cat')"
check "kopencode piped: name suppressed" '!kopencode' "$out"

out="$(run_pty 'kopencode run hi')"
check "kopencode run: name suppressed (non-interactive)" '!kopencode' "$out"

# --- kclaude: Kimi model + context mapping ------------------------------------
# Swap in the richer stub that echoes the selected model and context env.
printf '%s\n' "$STUBCLAUDE_MODEL" > "$STUBBIN/claude"
chmod +x "$STUBBIN/claude"

# The X-LLM-Force: kimi header is constant across both windows; the router remaps
# any leaked claude-* to Kimi models (asserted in llm-proxy-router's own tests).
out="$(run_pipe 'kclaude -p hi')"
check "kclaude default: model k3-256k"       "MODEL=k3-256k"                         "$out"
check "kclaude default: 256k context"        "CTX=262144 AUTOCOMPACT=262144"         "$out"
check "kclaude: X-LLM-Force kimi header"     "HEADERS=X-LLM-Force: kimi"             "$out"

out="$(run_pipe 'kclaude --1m -p hi')"
check "kclaude --1m: model k3"               "MODEL=k3"                              "$out"
check "kclaude --1m: 1M context"             "CTX=1000000 AUTOCOMPACT=1000000"       "$out"
check "kclaude --1m: X-LLM-Force kimi"       "HEADERS=X-LLM-Force: kimi"             "$out"

# --1m is recognised anywhere in the args, and stripped before reaching claude.
out="$(run_pipe 'kclaude -p hi --1m')"
check "kclaude --1m after args: model k3"    "MODEL=k3"                              "$out"

exit $fail
