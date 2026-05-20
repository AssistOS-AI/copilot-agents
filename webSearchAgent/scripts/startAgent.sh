#!/bin/sh
set -eu

node /code/server/headless-search-service.mjs &
SEARCH_SERVICE_PID="$!"

cleanup() {
    if kill -0 "$SEARCH_SERVICE_PID" 2>/dev/null; then
        kill "$SEARCH_SERVICE_PID" 2>/dev/null || true
        wait "$SEARCH_SERVICE_PID" 2>/dev/null || true
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

if ! kill -0 "$SEARCH_SERVICE_PID" 2>/dev/null; then
    echo "webSearchAgent browser service exited before startup" >&2
    exit 1
fi

sh /Agent/server/AgentServer.sh
