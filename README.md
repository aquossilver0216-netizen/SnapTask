# SnapTask

プリントや黒板を撮るだけで、課題名・教科・締切・やることをToDoにする高校生向けMVPです。下部の「暗記」では、教材写真から教科を判別して、教科書イラスト付きの暗記ページに整理できます。カードは後から単語帳を移動でき、一周学習・4択テスト・間違い復習で定着を確認できます。「共有」ではリンクを送るだけで別端末へ取り込め、端末の共有シートにも対応しています。

## 起動

`start-snaptask.command` をダブルクリックすると、スクリプトの場所を基準にプロジェクトを見つけ、空いているポート（3000〜3020）を選んで起動し、ブラウザも自動で開きます。手動で起動する場合は、プロジェクト内で `pnpm dev` を実行し、表示されたURLを開きます。すでに開いている古いタブではなく、起動時に表示されたURLを使ってください。

審査・発表用に初期状態を再現する場合は、起動URLの末尾に `?demo=1` を付けて開きます。課題・暗記・学習ログをデモ状態へ上書きするため、発表用の端末やブラウザで使ってください。

## AIモード

- **Gemma（Mac内）**：Bionic / LM StudioのDeveloper画面で `http://127.0.0.1:1234/v1` を起動します。追加・暗記画面を開くと自動で接続確認し、未接続ならGeminiへの切り替えボタンを表示します。`LOCAL_GEMMA_MODEL`を省略した場合は、接続先の`/v1/models`からGemmaのモデルIDを自動選択します。
- **Gemini API**：`.env.local` に `GEMINI_API_KEY=...` を設定して、画面の「Gemini API」に切り替えます。キーはブラウザへ送られません。

公開環境で `GEMINI_API_KEY` が設定されている場合は、初回表示時にGemini APIを自動選択します。ローカル開発ではGemmaを選び直せます。写真は1枚12MB以下、最大12枚まで読み込めます。

Gemini APIの写真解析は、予想外の費用を防ぐためこのMVPでは1端末あたり月20枚で停止します。Gemma（Mac内）はこの上限の対象外です。

課題と単語帳は端末のlocalStorageに保存されます。あとで大会向けにGeminiへ切り替える場合も、画面の選択とサーバー側ルートはそのまま使えます。

### 本番ログイン・端末間同期（Supabase）

Supabaseを接続すると、アカウント画面からメール登録・ログイン・ログアウトができ、課題・暗記カード・学習記録が端末間で同期されます。SupabaseのSQL Editorで次を一度だけ実行し、VercelのProduction環境変数に `NEXT_PUBLIC_SUPABASE_URL`（Project URL）と `NEXT_PUBLIC_SUPABASE_ANON_KEY`（anon public key）を登録して再デプロイしてください。`service_role`キーは登録しないでください。

```sql
create table public.snaptask_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.snaptask_data enable row level security;
create policy "users read own data" on public.snaptask_data for select using (auth.uid() = user_id);
create policy "users insert own data" on public.snaptask_data for insert with check (auth.uid() = user_id);
create policy "users update own data" on public.snaptask_data for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

写真のサムネイルは端末容量とプライバシーを守るためlocalStorageに残し、学習データ（課題・カード・記録）をクラウド同期します。

Stripe Checkoutはログイン中のSupabaseユーザーをサーバー側で検証してから決済セッションへ紐づけます。`STRIPE_SECRET_KEY`、Price IDなどのStripe環境変数がVercelに設定されていれば、ログイン後の契約状況もアカウントごとに確認できます。返金・解約を反映するには、StripeのDevelopers → Webhooksで `https://snap-task-xi.vercel.app/api/billing/webhook` を登録し、`checkout.session.completed`、`customer.subscription.created`、`customer.subscription.updated`、`customer.subscription.deleted`を購読、Signing secretをVercelの `STRIPE_WEBHOOK_SECRET`へ保存してください。

サーバー側のAPI枚数制限とStripe Webhookの書き込みには、Supabaseの `service_role`（またはsecret）キーをVercelの `SUPABASE_SERVICE_ROLE_KEY`へ登録します。これはサーバー専用で、`NEXT_PUBLIC_`を付けたり、画面やGitHubへ公開したりしないでください。API制限はログインユーザーごとに月20枚（契約中は300枚）で停止します。

ホームの「チュートリアル」では、写真の追加、読み取り結果の確認、学習記録、ミス復習・共有の流れを4ステップで確認できます。途中のステップへ戻ることもできます。

提出前の公開・デモ・AI設定チェックは [`docs/submission-checklist.md`](docs/submission-checklist.md) を確認してください。
公開先の設定と本番Gemini APIへの切り替えは [`docs/release.md`](docs/release.md) にまとめています。

### 公開前チェック

サーバーを起動した状態で `pnpm test:smoke http://localhost:3000` を実行すると、主要ページ・AIルートのヘルスチェック・Gemma接続確認・API入力検証を確認できます。ポート番号は起動時に表示されたものに置き換えてください。

## テック甲子園向け

課題の写真撮影から確認・保存・完了・日別振り返りまでのデモ台本は [`docs/tech-koshien-pitch.md`](docs/tech-koshien-pitch.md) にまとめています。
