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

const api = await fetch(`${base}/api/parse`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
const payload = await api.json();
if (api.status !== 400 || payload.error !== '写真がありません') throw new Error(`API validation: ${api.status}`);
console.log('✓ API入力バリデーション');
console.log(`SnapTask smoke test passed: ${base}`);
