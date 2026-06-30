#!/bin/sh
set -eu

VENV_DIR=/opt/gpt-researcher-venv

python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --upgrade pip
"$VENV_DIR/bin/python" -m pip install --no-cache-dir gpt-researcher
