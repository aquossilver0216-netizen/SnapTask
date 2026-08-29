import { NextResponse } from 'next/server';

type StripeList<T> = { data?: T[] };

async function stripeGet<T>(path: string, secretKey: string): Promise<T> {
  const response = await fetch(`https://api.stripe.com/v1/${path}`, { headers: { Authorization: `Bearer ${secretKey}` } });
  const payload = await response.json() as T;
  if (!response.ok) throw new Error('Stripeの契約状況を確認できませんでした。');
  return payload;
}

export async function GET(request: Request) {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) return NextResponse.json({ active: false });
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const authorization = request.headers.get('authorization');
  if (!supabaseUrl || !supabaseAnonKey || !authorization?.startsWith('Bearer ')) return NextResponse.json({ active: false });
  const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: supabaseAnonKey, Authorization: authorization } });
  if (!userResponse.ok) return NextResponse.json({ active: false });
  const user = await userResponse.json() as { id?: unknown; email?: unknown };
  if (typeof user.id === 'string') {
    const subscriptionResponse = await fetch(`${supabaseUrl}/rest/v1/snaptask_subscriptions?select=status&user_id=eq.${encodeURIComponent(user.id)}&limit=1`, { headers: { apikey: supabaseAnonKey, Authorization: authorization } });
    if (subscriptionResponse.ok) {
      const rows = await subscriptionResponse.json() as Array<{ status?: string }>;
      if (rows.length) return NextResponse.json({ active: rows[0].status === 'active' || rows[0].status === 'trialing' });
    }
  }
  if (typeof user.email !== 'string' || !user.email) return NextResponse.json({ active: false });
  const email = user.email;
  try {
    const customers = await stripeGet<StripeList<{ id: string; email?: string }>>(`customers?email=${encodeURIComponent(email)}&limit=10`, secretKey);
    const customer = customers.data?.find(item => item.email?.toLocaleLowerCase() === email.toLocaleLowerCase());
    if (!customer) return NextResponse.json({ active: false });
    const subscriptions = await stripeGet<StripeList<{ status?: string }>>(`subscriptions?customer=${encodeURIComponent(customer.id)}&status=all&limit=20`, secretKey);
    const active = subscriptions.data?.some(item => item.status === 'active' || item.status === 'trialing') ?? false;
    return NextResponse.json({ active });
  } catch (error) {
    return NextResponse.json({ active: false, error: error instanceof Error ? error.message : '契約状況を確認できませんでした。' }, { status: 502 });
  }
}
