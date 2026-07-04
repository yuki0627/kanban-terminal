#!/usr/bin/env bash
# Phase 0 manual reproduction for feat-202 (#202): run the interactive `claude` CLI
# inside the MulmoTerminal sandbox image and confirm it reaches the HOST's GUI MCP +
# activity hooks over host.docker.internal — the exact boundary the full feature
# automates. This lets us debug the container/host wiring before touching server code.
#
# Prereqs:
#   - Docker running.
#   - The MulmoTerminal server running on the host at $PORT (e.g. `yarn dev` or a build).
#
# Usage: PORT=34567 WORKSPACE="$PWD" scripts/sandbox-repro.sh
set -euo pipefail

PORT="${PORT:-34567}"
WORKSPACE="${WORKSPACE:-$PWD}"
SESSION_ID="${SESSION_ID:-00000000-0000-4000-8000-000000000000}"
IMAGE="mulmoterminal-sandbox"
HOST="host.docker.internal"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 1. Build the sandbox image if it isn't present.
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "[repro] building $IMAGE ..."
  # --load: with the buildx container driver (Docker's default) the result otherwise
  # stays in the build cache and never lands in the local image store.
  docker build --load -f "$REPO_ROOT/Dockerfile.sandbox" -t "$IMAGE" "$REPO_ROOT"
fi

# 2. Rewrite the two host-loopback configs (MCP + hooks) to reach the host from inside
#    the container. These mirror mcpConfigJson()/hookSettingsJson() in server/index.ts,
#    with localhost/127.0.0.1 → host.docker.internal.
CFG_DIR="$(mktemp -d)"
trap 'rm -rf "$CFG_DIR"' EXIT

cat > "$CFG_DIR/mcp.json" <<JSON
{ "mcpServers": { "mulmoterminal-gui": { "type": "http", "url": "http://$HOST:$PORT/api/mcp/$SESSION_ID" } } }
JSON

HOOK_CMD="curl -s -X POST http://$HOST:$PORT/api/hook -H 'content-type: application/json' -d @- >/dev/null 2>&1"
ENTRY="$(jq -n --arg c "$HOOK_CMD" '[{hooks:[{type:"command",command:$c}]}]')"
TOOL="$(jq -n --arg c "$HOOK_CMD" '[{matcher:"",hooks:[{type:"command",command:$c}]}]')"
jq -n --argjson e "$ENTRY" --argjson t "$TOOL" \
  '{hooks:{UserPromptSubmit:$e,Stop:$e,Notification:$e,PreToolUse:$t,PostToolUse:$t,PostToolUseFailure:$t}}' \
  > "$CFG_DIR/settings.json"

# 3. claude auth/config lives on the host — mount it read/write so the sandboxed CLI is
#    logged in and writes its transcript back. ~/.claude.json is optional (version-dependent).
CLAUDE_JSON_MOUNT=()
[ -f "$HOME/.claude.json" ] && CLAUDE_JSON_MOUNT=(-v "$HOME/.claude.json:/home/node/.claude.json")

echo "[repro] MCP    → http://$HOST:$PORT/api/mcp/$SESSION_ID"
echo "[repro] hooks  → http://$HOST:$PORT/api/hook"
echo "[repro] mounts: $WORKSPACE → /home/node/workspace ; ~/.claude ; configs (ro)"
echo "[repro] In the REPL: run '/mcp' and confirm mulmoterminal-gui shows 'connected',"
echo "[repro] then send a message and watch the host UI's activity dot update via hooks."

# 4. Run interactive claude in the sandbox. --add-host is required on Linux and harmless
#    on macOS/Windows Docker Desktop (where host.docker.internal already resolves).
docker run --rm -it \
  --add-host "host.docker.internal:host-gateway" \
  -e HOME=/home/node \
  -v "$WORKSPACE:/home/node/workspace" \
  -v "$HOME/.claude:/home/node/.claude" \
  "${CLAUDE_JSON_MOUNT[@]}" \
  -v "$CFG_DIR:/home/node/.mt-cfg:ro" \
  -w /home/node/workspace \
  "$IMAGE" \
  claude \
    --session-id "$SESSION_ID" \
    --settings /home/node/.mt-cfg/settings.json \
    --mcp-config /home/node/.mt-cfg/mcp.json \
    --strict-mcp-config \
    --allowedTools "mcp__mulmoterminal-gui" \
    --permission-mode "${CLAUDE_PERMISSION_MODE:-auto}"
