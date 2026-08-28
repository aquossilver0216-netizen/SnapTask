# SnapTask

プリントや黒板を撮るだけで、課題名・教科・締切・やることをToDoにする高校生向けMVPです。下部の「暗記」では、教材写真から教科を判別して、英語・数学・理科などの暗記ページに整理できます。カードは後から単語帳を移動でき、一周学習・4択テスト・間違い復習で定着を確認できます。「共有」では暗記ページをJSONとしてコピー・保存して別端末から取り込めます。

## 起動

`start-snaptask.command` をダブルクリックするか、プロジェクト内で `pnpm dev` を実行し、表示されたURLを開きます。3000〜3020の中から空いているポートを自動で選びます。すでに開いている古いタブではなく、起動時に表示されたURLを使ってください。

## AIモード

- **Gemma（Mac内）**：Bionic / LM StudioのDeveloper画面で `http://127.0.0.1:1234/v1` を起動します。追加画面の「Gemma接続を確認」で事前チェックできます。
- **Gemini API**：`.env.local` に `GEMINI_API_KEY=...` を設定して、画面の「Gemini API」に切り替えます。キーはブラウザへ送られません。

Gemini APIの写真解析は、予想外の費用を防ぐためこのMVPでは1端末あたり月20枚で停止します。Gemma（Mac内）はこの上限の対象外です。

課題と単語帳は端末のlocalStorageに保存されます。あとで大会向けにGeminiへ切り替える場合も、画面の選択とサーバー側ルートはそのまま使えます。

提出前の公開・デモ・AI設定チェックは [`docs/submission-checklist.md`](docs/submission-checklist.md) を確認してください。
公開先の設定と本番Gemini APIへの切り替えは [`docs/release.md`](docs/release.md) にまとめています。

### 公開前チェック

サーバーを起動した状態で `pnpm test:smoke http://localhost:3000` を実行すると、主要ページ・AIルートのヘルスチェック・API入力検証を確認できます。ポート番号は起動時に表示されたものに置き換えてください。

## テック甲子園向け

課題の写真撮影から確認・保存・完了・日別振り返りまでのデモ台本は [`docs/tech-koshien-pitch.md`](docs/tech-koshien-pitch.md) にまとめています。
