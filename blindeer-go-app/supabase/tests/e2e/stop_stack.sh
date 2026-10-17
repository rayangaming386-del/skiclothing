#!/usr/bin/env bash
RUN="${RUN_DIR:-$(cd "$(dirname "$0")" && pwd)/.run}"
for p in "$RUN"/*.pid; do [ -f "$p" ] && kill "$(cat "$p")" 2>/dev/null; rm -f "$p"; done
pkill -f "deno run --allow-net --allow-env --allow-read index.ts" 2>/dev/null || true
echo gestopt
