#!/bin/sh
set -eu

if command -v chromium >/dev/null 2>&1 \
    || command -v chromium-browser >/dev/null 2>&1 \
    || command -v google-chrome >/dev/null 2>&1; then
    echo "Chromium runtime already available"
    exit 0
fi

if command -v apt-get >/dev/null 2>&1; then
    echo "Installing Chromium and viewer dependencies for browserUseAgent"
    apt-get update
    apt-get install -y --no-install-recommends \
        chromium \
        ca-certificates \
        fonts-liberation \
        xvfb \
        x11vnc \
        novnc \
        websockify
    rm -rf /var/lib/apt/lists/*
    exit 0
fi

echo "ERROR: Chromium is required for browserUseAgent but no supported package manager was found" >&2
exit 1
