#!/usr/bin/env bash
# Unit checks for hooks/lib/harness.sh. Run: bash test/harness.test.sh
set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"
source "$DIR/hooks/lib/harness.sh"

fail=0
check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then
    echo "ok   - $1"
  else
    echo "FAIL - $1: expected '$2' got '$3'"; fail=1
  fi
}

# env-selected harness
check "env opencode -> opencode" opencode "$(CLAUDE_PERMS_HARNESS=opencode detect_harness '')"
check "env kimi -> kimi"         kimi     "$(CLAUDE_PERMS_HARNESS=kimi detect_harness '')"
check "env claude -> claude"     claude   "$(CLAUDE_PERMS_HARNESS=claude detect_harness '')"

# stdin-shape fallback (no env)
check "transcript_path -> claude" claude "$(detect_harness '{"transcript_path":"/x"}')"
check "tool_call_id -> kimi"      kimi   "$(detect_harness '{"tool_call_id":"c1"}')"
check "unknown -> claude"         claude "$(detect_harness '{}')"

# display name + instructions file
check "opencode agent name" opencode  "$(harness_agent_name opencode)"
check "opencode instructions" AGENTS.md "$(harness_instructions_file opencode)"
check "claude instructions"   CLAUDE.md "$(harness_instructions_file claude)"


# node-run.sh resolves a >=20 node even when PATH holds an old one
# (sessions launched from projects whose .nvmrc pins an old LTS).
v10=/home/chris/.nvm/versions/node/v10.24.1/bin
if [ -x "$v10/node" ]; then
  got=$(echo '{"session_id":"t"}' | PATH="$v10:/usr/bin:/bin" "$DIR/hooks/node-run.sh" -e 'process.stdout.write(process.version.split(".")[0])' 2>/dev/null)
  case "$got" in
    v2[0-9]|v[3-9][0-9]) echo "ok   - node-run.sh ignores old PATH node" ;;
    *) echo "FAIL - node-run.sh with old PATH node: got '$got'"; fail=1 ;;
  esac
else
  echo "skip - no node v10 installed for node-run.sh test"
fi

exit $fail
