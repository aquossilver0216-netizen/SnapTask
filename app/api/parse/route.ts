import { NextResponse } from 'next/server';

type Provider = 'gemma' | 'api';
type Input = { provider?: Provider; mode?: 'tasks' | 'memorize'; images?: Array<{ content?: string }> };
const prompt = `高校生向けのプリントや黒板写真から課題を抽出してください。画像に書かれている内容だけを使い、推測で補完しないでください。JSONだけを返してください。\n{"tasks":[{"title":"課題名","subject":"教科","dueDate":"YYYY-MM-DDまたは空文字","body":"やることの要約"}]}\n複数の課題を漏れなく抽出し、締切がなければ空文字にしてください。`;
const memorizePrompt = `学校の教材写真から、暗記用の重要事項を抽出してください。画像に書かれている内容だけを使い、推測で補完しないでください。教科名も画像から判別してください。JSONだけを返してください。\n{"cards":[{"front":"覚える語句・問題","back":"答え・説明","subject":"教科名"}]}\n英単語、公式、年号、用語など、写真にある重要事項を漏れなくカード化してください。`;

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

async function callVision(url: string, model: string, content: string, instruction: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${url.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ model, temperature: 0, max_tokens: 2048, messages: [{ role: 'user', content: [{ type: 'text', text: instruction }, { type: 'image_url', image_url: { url: `data:image/png;base64,${content}` } }] }] }) });
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
      for (const image of images) { const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: instruction }, { inline_data: { mime_type: 'image/png', data: image.content } }] }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }) }); if (!response.ok) throw new Error(await response.text()); const result = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> }; const parsed = parseJson(result.candidates?.[0]?.content?.parts?.[0]?.text ?? ''); tasks.push(...(mode === 'memorize' ? cleanCards(parsed?.cards) : cleanTasks(parsed?.tasks)));
      }
    } else {
      const base = process.env.LOCAL_GEMMA_BASE_URL || 'http://127.0.0.1:1234/v1'; const model = process.env.LOCAL_GEMMA_MODEL || 'google/gemma-4-e4b';
      for (const image of images) { const parsed = await callVision(base, model, image.content, instruction) as { tasks?: unknown; cards?: unknown }; tasks.push(...(mode === 'memorize' ? cleanCards(parsed.cards) : cleanTasks(parsed.tasks))); }
    }
    if (mode === 'memorize') { const unique = new Map<string, { front: string; back: string; subject: string }>(); for (const card of cleanCards(tasks)) unique.set(`${card.front}|${card.subject}`.toLowerCase(), card); return NextResponse.json({ cards: Array.from(unique.values()) }); }
    const unique = new Map<string, { title: string; subject: string; dueDate: string; body: string }>(); for (const task of cleanTasks(tasks)) unique.set(`${task.title}|${task.subject}`.toLowerCase(), task);
    return NextResponse.json({ tasks: Array.from(unique.values()) });
  } catch (error) { return NextResponse.json({ error: provider === 'gemma' ? 'Gemmaに接続できませんでした。ローカルサーバーを起動してください。' : 'APIで解析できませんでした。設定を確認してください。', detail: error instanceof Error ? error.message.slice(0, 400) : '' }, { status: 503 }); }
}
