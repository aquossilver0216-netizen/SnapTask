import { NextResponse } from 'next/server';

/** Stripe Checkout後の購入確認。キーや決済情報はレスポンスに含めません。 */
export async function GET(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  const sessionId = new URL(request.url).searchParams.get('session_id');
  if (!secretKey || !sessionId) return NextResponse.json({ active: false }, { status: 400 });
  if (process.env.STRIPE_TEST_MODE !== 'false' && !secretKey.startsWith('sk_test_')) return NextResponse.json({ active: false }, { status: 503 });
  const response = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${secretKey}` } });
  if (!response.ok) return NextResponse.json({ active: false }, { status: 502 });
  const session = await response.json() as { payment_status?: string; status?: string; mode?: string; subscription?: string | null };
  const active = session.mode === 'subscription' && session.status === 'complete' && session.payment_status === 'paid' && Boolean(session.subscription);
  return NextResponse.json({ active, uploadLimit: active ? 300 : 20 });
}
