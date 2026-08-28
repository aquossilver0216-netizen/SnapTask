#!/bin/zsh
set -e
PROJECT_DIR="/Users/torikunn/Documents/Codex/2026-08-27/new-chat/snaptask-app"
NODE_DIR="/Users/torikunn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
PNPM_DIR="/Users/torikunn/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback"
export PATH="$NODE_DIR:$PNPM_DIR:$PATH"
cd "$PROJECT_DIR"
PORT=3000
if command -v lsof >/dev/null 2>&1 && lsof -iTCP:3000 -sTCP:LISTEN -n -P >/dev/null 2>&1; then
  PORT=3001
fi
if command -v pnpm >/dev/null 2>&1; then
  pnpm dev -- --port "$PORT"
elif command -v npm >/dev/null 2>&1; then
  npm run dev -- --port "$PORT"
else
  echo "Node.jsが見つかりません。Codexからもう一度起動してください。"
  read -r
fi
