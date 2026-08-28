const base = (process.argv[2] || 'http://localhost:3000').replace(/\/$/, '');
const checks = [
  ['トップページ', '/', 200],
  ['PWA manifest', '/manifest.webmanifest', 200],
  ['アプリアイコン', '/icon.svg', 200],
];

for (const [label, path, expected] of checks) {
  const response = await fetch(`${base}${path}`);
  if (response.status !== expected) throw new Error(`${label}: ${response.status} (expected ${expected})`);
  console.log(`✓ ${label}`);
}

const health = await fetch(`${base}/api/parse`);
const healthPayload = await health.json();
if (health.status !== 200 || healthPayload.ok !== true || !healthPayload.providers) throw new Error(`API health: ${health.status}`);
console.log('✓ AIルートヘルスチェック');

const gemmaCheck = await fetch(`${base}/api/parse?check=gemma`);
const gemmaPayload = await gemmaCheck.json();
if (![200, 503].includes(gemmaCheck.status) || gemmaPayload.provider !== 'gemma' || typeof gemmaPayload.ok !== 'boolean') throw new Error(`Gemma check: ${gemmaCheck.status}`);
console.log(`✓ Gemma接続確認（${gemmaPayload.ok ? '接続中' : '未接続でも継続可能'}）`);

const api = await fetch(`${base}/api/parse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
const payload = await api.json();
if (api.status !== 400 || payload.error !== '写真がありません') throw new Error(`API validation: ${api.status}`);
console.log('✓ API入力バリデーション');

const malformed = await fetch(`${base}/api/parse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ images: [null, {}, { content: 123 }] }) });
const malformedPayload = await malformed.json();
if (malformed.status !== 400 || malformedPayload.error !== '写真がありません') throw new Error(`画像入力バリデーション: ${malformed.status}`);
console.log('✓ 画像入力バリデーション');
console.log(`SnapTask smoke test passed: ${base}`);
