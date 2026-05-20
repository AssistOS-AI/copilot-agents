#!/bin/sh
set -eu

case "${BROWSER_POOL_SIZE:-1}" in
    ""|0)
        echo "webSearchAgent browser pool disabled; skipping Chromium install"
        exit 0
        ;;
esac

if command -v chromium >/dev/null 2>&1 \
    || command -v chromium-browser >/dev/null 2>&1 \
    || command -v google-chrome >/dev/null 2>&1; then
    echo "Chromium runtime already available"
    exit 0
fi

if command -v apt-get >/dev/null 2>&1; then
    echo "Installing Chromium runtime for webSearchAgent"
    apt-get update
    apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation
    rm -rf /var/lib/apt/lists/*
    exit 0
fi

echo "ERROR: Chromium is required for webSearchAgent but no supported package manager was found" >&2
exit 1
