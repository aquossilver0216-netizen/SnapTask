import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function validSignature(rawBody: string, signature: string, secret: string) {
  const parts = Object.fromEntries(signature.split(',').map(item => item.split('=').map(value => value.trim())));
  if (!parts.t || !parts.v1) return false;
  const expected = createHmac('sha256', secret).update(`${parts.t}.${rawBody}`).digest('hex');
  const received = Buffer.from(parts.v1, 'utf8'); const calculated = Buffer.from(expected, 'utf8');
  return received.length === calculated.length && timingSafeEqual(received, calculated) && Math.abs(Date.now() / 1000 - Number(parts.t)) < 300;
}

async function upsertSubscription(row: Record<string, unknown>) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, ''); const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) throw new Error('Supabaseのサーバーキーが未設定です。');
  const response = await fetch(`${url}/rest/v1/snaptask_subscriptions?on_conflict=user_id`, { method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) });
  if (!response.ok) throw new Error('契約情報を保存できませんでした。');
}

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim(); const signature = request.headers.get('stripe-signature');
  if (!secret || !signature) return NextResponse.json({ error: 'Webhook設定が未完了です。' }, { status: 400 });
  const rawBody = await request.text(); if (!validSignature(rawBody, signature, secret)) return NextResponse.json({ error: '署名が正しくありません。' }, { status: 400 });
  let event: { type?: string; data?: { object?: Record<string, unknown> } };
  try { event = JSON.parse(rawBody) as typeof event; } catch { return NextResponse.json({ error: 'Webhookデータが不正です。' }, { status: 400 }); }
  const object = event.data?.object ?? {}; const metadata = typeof object.metadata === 'object' && object.metadata !== null ? object.metadata as Record<string, unknown> : {};
  const userId = String(metadata.user_id ?? object.client_reference_id ?? '').trim();
  if (!/^[0-9a-f-]{20,}$/i.test(userId)) return NextResponse.json({ received: true, ignored: true });
  const subscription = typeof object.subscription === 'string' ? object.subscription : typeof object.id === 'string' ? object.id : '';
  const customer = typeof object.customer === 'string' ? object.customer : '';
  const status = event.type === 'customer.subscription.deleted' ? 'canceled' : String(object.status ?? (event.type === 'checkout.session.completed' ? 'active' : 'inactive'));
  const currentPeriodEnd = Number(object.current_period_end);
  try { await upsertSubscription({ user_id: userId, stripe_customer_id: customer || null, stripe_subscription_id: subscription || null, status, current_period_end: Number.isFinite(currentPeriodEnd) && currentPeriodEnd > 0 ? new Date(currentPeriodEnd * 1000).toISOString() : null, updated_at: new Date().toISOString() }); return NextResponse.json({ received: true }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : 'Webhook処理に失敗しました。' }, { status: 503 }); }
}
