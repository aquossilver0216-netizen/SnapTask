export type AuthSession = {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  user: { id: string; email?: string; user_metadata?: Record<string, unknown> };
};

type SupabaseAuthResponse = { access_token?: string; refresh_token?: string; expires_in?: number; user?: AuthSession['user']; error_description?: string; msg?: string; message?: string };

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function isSupabaseConfigured() { return Boolean(supabaseUrl && supabaseAnonKey); }

function requireConfig() {
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabaseの接続設定がまだ完了していません。');
  return { url: supabaseUrl, key: supabaseAnonKey };
}

async function authRequest(path: string, body: Record<string, unknown>): Promise<SupabaseAuthResponse> {
  const config = requireConfig();
  const response = await fetch(`${config.url}/auth/v1/${path}`, { method: 'POST', headers: { apikey: config.key, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const payload = await response.json().catch(() => ({})) as SupabaseAuthResponse;
  if (!response.ok) throw new Error(payload.error_description ?? payload.msg ?? payload.message ?? '認証に失敗しました。');
  return payload;
}

function toSession(payload: SupabaseAuthResponse): AuthSession {
  if (!payload.access_token || !payload.user?.id) throw new Error('ログイン情報を受け取れませんでした。');
  return { access_token: payload.access_token, refresh_token: payload.refresh_token, expires_in: payload.expires_in, expires_at: payload.expires_in ? Math.floor(Date.now() / 1000) + payload.expires_in : undefined, user: payload.user };
}

export async function signUp(email: string, password: string, displayName: string) {
  return toSession(await authRequest('signup', { email, password, data: { display_name: displayName } }));
}

export async function signIn(email: string, password: string) {
  return toSession(await authRequest('token?grant_type=password', { email, password }));
}

export async function refreshSession(refreshToken: string) {
  return toSession(await authRequest('token?grant_type=refresh_token', { refresh_token: refreshToken }));
}

export async function signOut(session: AuthSession) {
  const config = requireConfig();
  const response = await fetch(`${config.url}/auth/v1/logout`, { method: 'POST', headers: { apikey: config.key, Authorization: `Bearer ${session.access_token}` } });
  if (!response.ok) throw new Error('ログアウトに失敗しました。');
}

export async function fetchRemoteData(session: AuthSession) {
  const config = requireConfig();
  const response = await fetch(`${config.url}/rest/v1/snaptask_data?select=payload&user_id=eq.${encodeURIComponent(session.user.id)}&limit=1`, { headers: { apikey: config.key, Authorization: `Bearer ${session.access_token}` } });
  if (!response.ok) throw new Error('クラウドデータを読み込めませんでした。');
  const rows = await response.json() as Array<{ payload?: unknown }>;
  return rows[0]?.payload ?? null;
}

export async function saveRemoteData(session: AuthSession, payload: unknown) {
  const config = requireConfig();
  const response = await fetch(`${config.url}/rest/v1/snaptask_data?on_conflict=user_id`, { method: 'POST', headers: { apikey: config.key, Authorization: `Bearer ${session.access_token}`, 'content-type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: session.user.id, payload, updated_at: new Date().toISOString() }) });
  if (!response.ok) throw new Error('クラウドデータを保存できませんでした。');
}
