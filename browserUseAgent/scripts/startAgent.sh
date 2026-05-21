#!/bin/sh
set -eu

detect_browser_executable() {
    if [ -n "${BROWSER_EXECUTABLE_PATH:-}" ]; then
        return
    fi

    for candidate in chromium chromium-browser google-chrome; do
        if command -v "$candidate" >/dev/null 2>&1; then
            export BROWSER_EXECUTABLE_PATH="$(command -v "$candidate")"
            return
        fi
    done
}

detect_browser_executable

export BROWSER_USE_SERVICE_HOST="${BROWSER_USE_SERVICE_HOST:-127.0.0.1}"
export BROWSER_USE_BIND_HOST="${BROWSER_USE_BIND_HOST:-${PLOINKY_AGENT_BIND_HOST:-0.0.0.0}}"
export BROWSER_USE_SERVICE_PORT="${BROWSER_USE_SERVICE_PORT:-${PORT:-7000}}"
export BROWSER_USE_MCP_PORT="${BROWSER_USE_MCP_PORT:-7001}"

PORT="$BROWSER_USE_MCP_PORT" sh /Agent/server/AgentServer.sh &
MCP_PID="$!"

node /code/server/browser-use-server.mjs &
SERVICE_PID="$!"

cleanup() {
    if kill -0 "$MCP_PID" 2>/dev/null; then
        kill "$MCP_PID" 2>/dev/null || true
        wait "$MCP_PID" 2>/dev/null || true
    fi
    if kill -0 "$SERVICE_PID" 2>/dev/null; then
        kill "$SERVICE_PID" 2>/dev/null || true
        wait "$SERVICE_PID" 2>/dev/null || true
    fi
}
trap cleanup INT TERM EXIT

i=0
while [ "$i" -lt 50 ]; do
    if node /code/scripts/check-service.mjs; then
        break
    fi
    i=$((i + 1))
    sleep 0.1
done

if ! kill -0 "$SERVICE_PID" 2>/dev/null; then
    echo "browserUseAgent service exited before startup" >&2
    exit 1
fi

wait "$SERVICE_PID"
