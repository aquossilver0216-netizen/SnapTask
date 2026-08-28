# SnapTask｜公開手順

テック甲子園の提出用に、公開URLを用意するときの手順です。公開先はVercelなどのNext.js対応ホスティングを想定しています。

## 1. 公開前に確認

```bash
pnpm run lint
pnpm run build
pnpm test:smoke http://localhost:3000
```

`pnpm run build` は標準の Next.js 本番ビルド（Webpack）を使うため、VercelのNext.js検出と同じ構成で確認できます。

起動ポートが3000以外なら、表示されたURLへ置き換えます。

## 2. Vercelへ登録

1. GitHubへこのリポジトリをpushする。
2. VercelでリポジトリをImportする。
3. Build Commandは空欄（`package.json`の`build`を使用）にする。
4. 次の環境変数をProductionへ登録する。

| 変数 | 公開環境の値 |
| --- | --- |
| `GEMINI_API_KEY` | Google AI Studioで発行したキー |
| `GEMINI_MODEL` | `gemini-2.5-flash`（必要に応じて変更） |

`LOCAL_GEMMA_BASE_URL`は公開サーバーから開発Macへ接続できないため、公開環境には設定しません。公開版の写真解析は画面で「Gemini API」を選びます。Gemmaは開発・オフラインデモ用です。`GEMINI_API_KEY`が設定された公開環境では、初回表示時にGemini APIが自動選択されます。写真は1枚12MB以下・最大12枚です。

### GitHub PagesではなくVercelを使う理由

GitHub Pagesは静的ファイル配信のみで、SnapTaskの`/api/parse`（Gemini APIを呼ぶサーバー処理）を実行できません。GitHubにはソースコードを置き、GitHub連携したVercelでNext.jsアプリとして公開してください。これなら公開URLから写真解析まで動作し、APIキーもVercelの環境変数に隠せます。

## 3. 公開後の確認

公開URLで次を確認します。

```bash
pnpm test:smoke https://公開URL
```

ブラウザで `https://公開URL/api/parse` を開き、`ok: true` と `providers.api: true` を確認します。キーの値そのものは表示されません。

次にスマートフォンで、写真追加→読み取り結果の編集→保存→完了チェック→暗記テスト→日別カレンダー→暗記ページ共有の順に一度通します。Gemini APIを使わない場合は、サンプルボタンで同じ導線を確認できます。

## 4. 課金・費用の安全策

- APIキーをソースコード、GitHub、スクリーンショットへ書かない。
- Google Cloud / AI Studio側で予算通知と利用上限を設定する。
- Vercel側にも利用量・請求アラートを設定する。
- 提出デモでは、必要な写真だけを少数枚選ぶ。
- SnapTask側でもGemini APIの写真利用を1端末あたり月20枚で停止する（Gemmaは対象外）。本格運用ではログイン・決済サーバー側でも利用量を管理する。
- 公開後に料金と無料枠の条件が変わっていないか、提出直前に公式ページで再確認する。
- 「共有リンク」は暗記カードをURLハッシュへ埋め込む端末保存MVP。ログイン不要で友だちへ渡せるが、公開リンクの取り消し・共有回数課金などを本番運用する場合は、認証・共有データベース・決済サーバーを追加する。
- AI接続エラーの詳細はブラウザへ返さず、利用者には復旧案内だけを表示する。調査が必要な場合は公開サーバーのログで確認する。

## 5. 提出物に記載する情報

- 公開URL
- 対応端末（スマートフォンSafari / Chrome）
- AI処理の選択肢（Gemmaローカル / Gemini API）
- 写真は確認・編集してから保存する設計
- データは端末のlocalStorageに保存され、バックアップ保存・復元ができること
- 暗記ページをJSONで共有・取り込みできること（本番の公開リンクは別途サーバー実装）
- AIが利用できない場合のサンプル導線

## 6. テック甲子園提出前の最終確認

公式FAQではWebアプリも応募対象で、一般ユーザーがアクセスできるリリース済み状態が必要です。1次審査の提出物は、リリースURL、ビルド前ソースコードzip、キャプチャ動画、スクリーンショット4枚、公式テンプレートの企画書PDFです。2026年の1次審査作品データ提出締切は8月30日（日）17:00と案内されています。締切・提出フォームは変更される可能性があるため、提出直前に[公式FAQ](https://techkoshien.jp/faq)と[開発部門エントリー](https://techkoshien.jp/develop-entry)を必ず確認してください。
