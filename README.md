# SnapTask

プリントや黒板を撮るだけで、課題名・教科・締切・やることをToDoにする高校生向けMVPです。

## 起動

`start-snaptask.command` をダブルクリックするか、プロジェクト内で `pnpm dev` を実行し、表示された `http://localhost:3000`（Tanngoが起動中なら `3001`）を開きます。

## AIモード

- **Gemma（Mac内）**：Bionic / LM StudioのDeveloper画面で `http://127.0.0.1:1234/v1` を起動します。
- **Gemini API**：`.env.local` に `GEMINI_API_KEY=...` を設定して、画面の「Gemini API」に切り替えます。キーはブラウザへ送られません。

課題と単語帳は端末のlocalStorageに保存されます。あとで大会向けにGeminiへ切り替える場合も、画面の選択とサーバー側ルートはそのまま使えます。
