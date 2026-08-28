import { NextResponse } from 'next/server';

/**
 * Stripe Checkoutの接続口。
 * 秘密鍵・価格IDを設定するまでは決済を開始せず、安全に設定不足を返します。
 */
export async function POST() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID_PREMIUM;
  const appUrl = process.env.APP_URL ?? 'https://snap-task-xi.vercel.app';
  if (!secretKey || !priceId) return NextResponse.json({ error: '決済設定が未完了です。Stripeの環境変数を設定してください。' }, { status: 503 });
  // 誤課金防止のため、モードとキーの接頭辞を必ず一致させる。
  // 未設定・true はテスト、false にした場合だけ本番キーを許可する。
  const liveMode = process.env.STRIPE_TEST_MODE === 'false';
  const expectedPrefix = liveMode ? 'sk_live_' : 'sk_test_';
  if (!secretKey.startsWith(expectedPrefix)) {
    return NextResponse.json({ error: liveMode ? '本番モードにはStripeのsk_live_キーを設定してください。' : '現在はテストモードです。Stripeのsk_test_キーを設定してください。' }, { status: 503 });
  }

  const params = new URLSearchParams({
    mode: 'subscription',
    'line_items[0][price]': priceId,
    'line_items[0][quantity]': '1',
    success_url: `${appUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${appUrl}/?checkout=cancelled`,
    'subscription_data[metadata][product]': 'snaptask-premium',
  });
  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  const data = await response.json() as { url?: string; error?: { message?: string } };
  if (!response.ok || !data.url) return NextResponse.json({ error: data.error?.message ?? '決済ページを作成できませんでした' }, { status: 502 });
  return NextResponse.json({ url: data.url });
}
