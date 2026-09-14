#!/bin/sh
# Resolve a modern node (>=20) to run a hook script, independent of the
# session's nvm state. Hooks use ES modules (.mjs), which node <=11 cannot
# parse — e.g. a session launched from a project whose .nvmrc pins an old LTS
# (nvm-auto switches the shell, and hooks inherit that PATH).
#
# Resolution order:
#   1. node on PATH, if >=20 (the normal case)
#   2. newest nvm install matching the nvm default alias (survives patch and
#      minor version bumps, unlike a hardcoded absolute path)
# If neither yields a usable node, fail loudly — never silently skip the hook.

node_bin=''
if command -v node >/dev/null 2>&1; then
  case "$(node --version 2>/dev/null)" in
    v2[0-9].* | v[3-9][0-9].*) node_bin="$(command -v node)" ;;
  esac
fi

if [ -z "$node_bin" ]; then
  default=$(cat "$HOME"/.nvm/alias/default 2>/dev/null)
  if [ -n "$default" ]; then
    # Glob sorts lexically, so the LAST match is the newest matching install.
    # Trailing /dev/null keeps the glob from leaking literally when it matches nothing.
    for d in "$HOME"/.nvm/versions/node/v${default}* /dev/null; do
      [ -x "$d/bin/node" ] && node_bin="$d/bin/node"
    done
  fi
fi

if [ -z "$node_bin" ]; then
  echo "node-run.sh: no node >=20 found (PATH node too old or missing, nvm default unusable)" >&2
  exit 1
fi

exec "$node_bin" "$@"
