#!/bin/zsh
set -e
PROJECT_DIR="/Users/torikunn/Documents/Codex/2026-08-27/new-chat/snaptask-app"
NODE_DIR="/Users/torikunn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
PNPM_DIR="/Users/torikunn/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback"
export PATH="$NODE_DIR:$PNPM_DIR:$PATH"
cd "$PROJECT_DIR"
if command -v pnpm >/dev/null 2>&1; then
  pnpm dev
elif command -v npm >/dev/null 2>&1; then
  npm run dev
else
  echo "Node.jsが見つかりません。Codexからもう一度起動してください。"
  read -r
fi
