#!/bin/zsh
set -e
PROJECT_DIR="/Users/torikunn/Documents/Codex/2026-08-27/new-chat/snaptask-app"
NODE_DIR="/Users/torikunn/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin"
PNPM_DIR="/Users/torikunn/.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback"
export PATH="$NODE_DIR:$PNPM_DIR:$PATH"
cd "$PROJECT_DIR"
PORT=3000
FOUND_PORT=0
if command -v lsof >/dev/null 2>&1; then
  # Tanngoや古い開発サーバーが起動中でも、空いているポートで続ける。
  for CANDIDATE in {3000..3020}; do
    if ! lsof -iTCP:"$CANDIDATE" -sTCP:LISTEN -n -P >/dev/null 2>&1; then
      PORT="$CANDIDATE"
      FOUND_PORT=1
      break
    fi
  done
fi
if [[ "$FOUND_PORT" -eq 0 && "$PORT" -eq 3000 ]] && command -v lsof >/dev/null 2>&1; then
  echo "空いているポートが見つかりませんでした。起動中の開発サーバーを閉じてから、もう一度実行してください。"
  read -r
  exit 1
fi
echo "SnapTaskを http://localhost:$PORT/ で起動します。"
if command -v open >/dev/null 2>&1; then
  (sleep 1; open "http://localhost:$PORT/") &
fi
if command -v pnpm >/dev/null 2>&1; then
  pnpm dev -- --port "$PORT"
elif command -v npm >/dev/null 2>&1; then
  npm run dev -- --port "$PORT"
else
  echo "Node.jsが見つかりません。Codexからもう一度起動してください。"
  read -r
fi
