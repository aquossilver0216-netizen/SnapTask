import { NextResponse } from 'next/server';

/**
 * Stripe Checkoutの接続口。
 * 秘密鍵・価格IDを設定するまでは決済を開始せず、安全に設定不足を返します。
 */
export async function POST(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  const liveMode = process.env.STRIPE_TEST_MODE === 'false';
  // 本番とテストでPrice IDも分離し、環境をまたいだ設定ミスを防ぐ。
  const priceId = liveMode ? process.env.STRIPE_PRICE_ID_PREMIUM_LIVE : process.env.STRIPE_PRICE_ID_PREMIUM;
  const appUrl = process.env.APP_URL ?? 'https://snap-task-xi.vercel.app';
  if (!secretKey || !priceId) return NextResponse.json({ error: '決済設定が未完了です。Stripeの環境変数を設定してください。' }, { status: 503 });
  // 誤課金防止のため、モードとキーの接頭辞を必ず一致させる。
  // 未設定・true はテスト、false にした場合だけ本番キーを許可する。
  const expectedPrefix = liveMode ? 'sk_live_' : 'sk_test_';
  if (!secretKey.startsWith(expectedPrefix)) {
    return NextResponse.json({ error: liveMode ? '本番モードにはStripeのsk_live_キーを設定してください。' : '現在はテストモードです。Stripeのsk_test_キーを設定してください。' }, { status: 503 });
  }

  const body = await request.json().catch(() => ({})) as { email?: unknown };
  let userId = '';
  let verifiedEmail = '';
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization = request.headers.get('authorization');
  if (supabaseUrl && supabaseAnonKey && authorization?.startsWith('Bearer ')) {
    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: supabaseAnonKey, Authorization: authorization } });
    if (userResponse.ok) {
      const user = await userResponse.json() as { id?: unknown; email?: unknown };
      if (typeof user.id === 'string' && /^[0-9a-f-]{20,}$/i.test(user.id)) userId = user.id;
      if (typeof user.email === 'string') verifiedEmail = user.email;
    }
  }
  const email = verifiedEmail || (typeof body.email === 'string' && /^\S+@\S+\.\S+$/.test(body.email) ? body.email : '');

  const params = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: `${appUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/?checkout=cancelled`,
    'metadata[product]': 'snaptask-premium',
    'subscription_data[metadata][product]': 'snaptask-premium',
    // Stripe Checkoutにプロモーションコード入力欄を表示する。
    // 審査用の100%オフコードも、同じ本番Checkoutから安全に適用できる。
    allow_promotion_codes: 'true',
  });
  if (userId) { params.set('client_reference_id', userId); params.set('metadata[user_id]', userId); params.set('subscription_data[metadata][user_id]', userId); }
  if (email) params.set('customer_email', email);
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const data = await response.json() as { url?: string; error?: { message?: string } };
  if (!response.ok || !data.url) return NextResponse.json({ error: data.error?.message ?? '決済ページを作成できませんでした' }, { status: 502 });
  return NextResponse.json({ url: data.url });
}
