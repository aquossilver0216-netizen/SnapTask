import { NextResponse } from 'next/server';

type Provider = 'gemma' | 'api';
type Input = { provider?: Provider; mode?: 'tasks' | 'memorize'; images?: Array<{ content?: string }> };
const prompt = `高校生向けのプリント・黒板写真を、提出物の一覧に変換してください。複数画像は同じプリントの続きとしてまとめて読み、画像に書かれている内容だけを使ってください。推測で補完したり、課題ではない説明文・ページ番号だけを課題にしたりしないでください。写真内の表や箇条書きは行ごとの対応を保ち、同じ課題を重複させないでください。JSONだけを返してください（Markdownや前置きは禁止）。\n{"tasks":[{"title":"写真に書かれた課題名","subject":"教科名","dueDate":"YYYY-MM-DDまたは空文字","body":"写真に書かれた提出物・やることの要約"}]}\n課題は見つかった分を漏れなく抽出してください。締切が明記されていない場合はdueDateを空文字にし、日付を勝手に作らないでください。日付が「8/30」「8月30日」のように年なしの場合は現在年を使ってください。`;
const memorizePrompt = `学校の教材写真を、復習できる暗記カードに変換してください。複数画像は同じ教材の続きとしてまとめて読み、写真にある文字をできるだけ正確に転記してください。英単語の綴り、記号、数式、年号、固有名詞を変更しないでください。左右の列や表の行は正しい意味同士を組み合わせ、見出しだけ・ページ番号だけのカードは作らないでください。教科は写真の内容から判断し、判断できなければ「その他」にしてください。推測や一般知識で補完せず、JSONだけを返してください（Markdownや前置きは禁止）。\n{"cards":[{"front":"覚える語句・問題・公式","back":"写真に書かれた答え・説明・意味","subject":"英語 / 数学 / 理科 / 社会 / 国語 / その他"}]}\n写真にある重要事項を1行1カードで漏れなく抽出し、同じカードは重複させないでください。`;

function parseJson(text: string): Record<string, unknown> | null {
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(clean) as { tasks?: unknown }; } catch { const start = clean.indexOf('{'); const end = clean.lastIndexOf('}'); if (start >= 0 && end > start) { try { return JSON.parse(clean.slice(start, end + 1)) as { tasks?: unknown }; } catch { return null; } } return null; }
}
function cleanCards(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(item => { const row = item as Record<string, unknown>; return { front: String(row.front ?? '').trim(), back: String(row.back ?? '').trim(), subject: String(row.subject ?? 'その他').trim() || 'その他' }; }).filter(card => card.front && card.back).slice(0, 120);
}
function cleanTasks(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(item => { const row = item as Record<string, unknown>; return { title: String(row.title ?? '').trim(), subject: String(row.subject ?? '').trim(), dueDate: String(row.dueDate ?? '').trim(), body: String(row.body ?? '').trim() }; }).filter(task => task.title && (task.subject || task.body)).slice(0, 80);
}

async function callVision(url: string, model: string, images: Array<{ content: string }>, instruction: string, headers: Record<string, string> = {}) {
  const content = [{ type: 'text', text: instruction }, ...images.map(image => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${image.content}` } }))];
  const response = await fetch(`${url.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ model, temperature: 0, max_tokens: 4096, messages: [{ role: 'user', content }] }) });
  if (!response.ok) throw new Error(await response.text());
  const result = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
  return parseJson(result.choices?.[0]?.message?.content ?? '') ?? {};
}

export async function POST(request: Request) {
  let body: Input; try { body = await request.json() as Input; } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
  const images = (body.images ?? []).filter(image => image.content).slice(0, 12) as Array<{ content: string }>;
  if (!images.length) return NextResponse.json({ error: '写真がありません' }, { status: 400 });
  const provider = body.provider === 'api' ? 'api' : 'gemma';
  const mode = body.mode === 'memorize' ? 'memorize' : 'tasks';
  const instruction = mode === 'memorize' ? memorizePrompt : prompt;
  try {
    const tasks: unknown[] = [];
    if (provider === 'api') {
      const key = process.env.GEMINI_API_KEY;
      if (!key) return NextResponse.json({ error: 'GEMINI_API_KEYが未設定です' }, { status: 503 });
      const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
      const parts = [{ text: instruction }, ...images.map(image => ({ inline_data: { mime_type: 'image/png', data: image.content } }))];
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }) });
      if (!response.ok) throw new Error(await response.text());
      const result = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const parsed = parseJson(result.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
      tasks.push(...(mode === 'memorize' ? cleanCards(parsed?.cards) : cleanTasks(parsed?.tasks)));
    } else {
      const base = process.env.LOCAL_GEMMA_BASE_URL || 'http://127.0.0.1:1234/v1'; const model = process.env.LOCAL_GEMMA_MODEL || 'google/gemma-4-e4b';
      const parsed = await callVision(base, model, images, instruction) as { tasks?: unknown; cards?: unknown };
      tasks.push(...(mode === 'memorize' ? cleanCards(parsed.cards) : cleanTasks(parsed.tasks)));
    }
    if (mode === 'memorize') { const unique = new Map<string, { front: string; back: string; subject: string }>(); for (const card of cleanCards(tasks)) unique.set(`${card.front}|${card.subject}`.toLowerCase(), card); return NextResponse.json({ cards: Array.from(unique.values()) }); }
    const unique = new Map<string, { title: string; subject: string; dueDate: string; body: string }>(); for (const task of cleanTasks(tasks)) unique.set(`${task.title}|${task.subject}`.toLowerCase(), task);
    return NextResponse.json({ tasks: Array.from(unique.values()) });
  } catch (error) { return NextResponse.json({ error: provider === 'gemma' ? 'Gemmaに接続できませんでした。ローカルサーバーを起動してください。' : 'APIで解析できませんでした。設定を確認してください。', detail: error instanceof Error ? error.message.slice(0, 400) : '' }, { status: 503 }); }
}
