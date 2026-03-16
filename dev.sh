#!/bin/bash
# Start both server and client for development.
# Extra arguments are forwarded to the server process.
# Usage: ./scripts/dev.sh --permission-mode plan

trap 'kill 0' EXIT

bun run server/index.ts "$@" &
bunx vite --host &
wait
