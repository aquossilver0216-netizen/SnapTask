import { NextResponse } from 'next/server';

type Provider = 'gemma' | 'api';
type Input = { provider?: Provider; mode?: 'tasks' | 'memorize'; images?: Array<{ content?: string; mimeType?: string }> };
const defaultGeminiModel = 'gemini-3.6-flash';
const prompt = `高校生向けのプリント・黒板写真を、提出物の一覧に変換してください。複数画像は同じプリントの続きとしてまとめて読み、画像に書かれている内容だけを使ってください。推測で補完したり、課題ではない説明文・ページ番号だけを課題にしたりしないでください。写真内の表や箇条書きは行ごとの対応を保ち、同じ課題を重複させないでください。JSONだけを返してください（Markdownや前置きは禁止）。\n{"tasks":[{"title":"写真に書かれた課題名","subject":"教科名","dueDate":"YYYY-MM-DDまたは空文字","body":"写真に書かれた提出物・やることの要約"}]}\n課題は見つかった分を漏れなく抽出してください。締切が明記されていない場合はdueDateを空文字にし、日付を勝手に作らないでください。日付が「8/30」「8月30日」のように年なしの場合は現在年を使ってください。`;
const memorizePrompt = `学校の教材写真を、復習できる暗記カードに変換してください。複数画像は同じ教材の続きとしてまとめて読み、写真にある文字をできるだけ正確に転記してください。英単語の綴り、記号、数式、年号、固有名詞を変更しないでください。左右の列や表の行は正しい意味同士を組み合わせ、見出しだけ・ページ番号だけのカードは作らないでください。教科は写真の内容から判断し、判断できなければ「その他」にしてください。推測や一般知識で補完せず、JSONだけを返してください（Markdownや前置きは禁止）。\n{"cards":[{"front":"覚える語句・問題・公式","back":"写真に書かれた答え・説明・意味","subject":"英語 / 数学 / 理科 / 社会 / 国語 / その他"}]}\n写真にある重要事項を1行1カードで漏れなく抽出し、同じカードは重複させないでください。`;

function parseJson(text: string): Record<string, unknown> | null {
  const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const parsed = JSON.parse(clean) as unknown;
    return Array.isArray(parsed) ? { cards: parsed, tasks: parsed } : recordOf(parsed);
  } catch {
    const objectStart = clean.indexOf('{'); const objectEnd = clean.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) { try { return recordOf(JSON.parse(clean.slice(objectStart, objectEnd + 1))); } catch { /* 配列形式を下で試す */ } }
    const arrayStart = clean.indexOf('['); const arrayEnd = clean.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) { try { const parsed = JSON.parse(clean.slice(arrayStart, arrayEnd + 1)) as unknown; return Array.isArray(parsed) ? { cards: parsed, tasks: parsed } : null; } catch { return null; } }
    // Visionモデルによっては、JSONの代わりに表・箇条書きで返すことがある。
    // その場合も「英単語 - 日本語」のような行をカードとして救済する。
    const rows = parseLooseRows(clean);
    return rows.length ? {
      cards: rows,
      tasks: rows.map(row => ({ title: row.front, subject: row.subject, dueDate: '', body: row.back })),
    } : null;
  }
}

function parseLooseRows(text: string): Array<{ front: string; back: string; subject: string }> {
  const rows: Array<{ front: string; back: string; subject: string }> = [];
  const seen = new Set<string>();
  for (const source of text.split(/\r?\n/)) {
    let line = source.trim();
    if (!line || /^[-|: ]+$/.test(line) || /^(front|term|word|単語|意味|説明|英単語|日本語)$/i.test(line)) continue;
    line = line.replace(/^\s*(?:[-*・]|\d+[.)])\s*/, '').trim();
    if (line.startsWith('|')) line = line.slice(1);
    if (line.endsWith('|')) line = line.slice(0, -1);
    const cells = line.split('|').map(cell => cell.trim()).filter(Boolean);
    let front = '';
    let back = '';
    if (cells.length >= 2) {
      [front, back] = cells;
    } else {
      const match = line.match(/^(.*?)\s*(?:\t+|\s+(?:=>|->|→|[-–—])\s+|\s*[:：]\s+)(.+)$/);
      if (!match) continue;
      front = match[1].trim();
      back = match[2].trim();
    }
    if (!front || !back || front.length > 160 || back.length > 500) continue;
    if (/^(front|term|word|単語|意味|説明|英単語|日本語)$/i.test(front) || /^[-:]+$/.test(back)) continue;
    const key = `${front.toLocaleLowerCase()}|${back.toLocaleLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ front, back, subject: 'その他' });
  }
  return rows.slice(0, 120);
}

function modelContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(part => modelContent(part)).filter(Boolean).join('\n');
  }
  if (value && typeof value === 'object') {
    const row = recordOf(value);
    if (typeof row.text === 'string') return row.text;
    if (Array.isArray(row.parts)) return modelContent(row.parts);
    return JSON.stringify(value);
  }
  return '';
}
function cleanCards(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(item => { const row = recordOf(item); return { front: String(row.front ?? row.term ?? row.word ?? row.expression ?? row.english ?? row.question ?? row.prompt ?? row.keyword ?? row.title ?? row.name ?? '').trim(), back: String(row.back ?? row.meaning ?? row.translation ?? row.japanese ?? row.definition ?? row.answer ?? row.explanation ?? row.description ?? row.gloss ?? '').trim(), subject: String(row.subject ?? row.deck ?? row.category ?? row.topic ?? 'その他').trim() || 'その他' }; }).filter(card => card.front && card.back).slice(0, 120);
}
function cleanTasks(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(item => { const row = recordOf(item); return { title: String(row.title ?? row.name ?? row.assignment ?? '').trim(), subject: String(row.subject ?? row.class ?? '').trim(), dueDate: String(row.dueDate ?? row.deadline ?? '').trim(), body: String(row.body ?? row.description ?? row.todo ?? '').trim() }; }).filter(task => task.title && (task.subject || task.body)).slice(0, 80);
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {};
}

function gemmaErrorMessage(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  if (/timeout|aborted/i.test(reason)) {
    return 'Gemmaの解析に時間がかかりすぎました。写真を1〜2枚ずつに分けるか、Bionicのモデルを確認してもう一度試してね。';
  }
  if (/cannot handle this data type|process inputs|image|vision/i.test(reason)) {
    return 'Gemmaが画像を解析できませんでした。Bionic / LM Studioで画像対応モデルを選び、写真をもう一度試してね。';
  }
  if (/model.*(not found|does not exist)|no such model/i.test(reason)) {
    return 'Gemmaのモデルが見つかりません。Developer画面でGemma 4 E4Bを読み込んでね。';
  }
  return 'Gemmaに接続できませんでした。Bionic / LM Studioで http://127.0.0.1:1234/v1 を起動してください。';
}

function geminiErrorMessage(error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  if (/no longer available|not found|NOT_FOUND|404/i.test(reason)) {
    return 'Geminiのモデルが利用できません。VercelのGEMINI_MODELをgemini-3.6-flashに変更してね。';
  }
  if (/quota|resource_exhausted|rate.?limit|429/i.test(reason)) {
    return 'Gemini APIの無料枠を使い切りました。Google AI Studioの上限がリセットされるまで待つか、Gemmaモードを使ってね。';
  }
  if (/api key|api_key|unauthenticated|unauthorized|invalid.*key|401/i.test(reason)) {
    return 'Gemini APIキーが正しくありません。VercelのGEMINI_API_KEYを確認してね。';
  }
  if (/invalid argument|unsupported|image|400/i.test(reason)) {
    return 'Geminiがこの画像を解析できませんでした。写真を明るく撮り直すか、1〜2枚ずつ試してね。';
  }
  return 'Gemini APIで解析できませんでした。しばらくしてからもう一度試してね。';
}

function normalizeImageMimeType(value: unknown) {
  const mime = typeof value === 'string' ? value.toLowerCase() : '';
  if (mime === 'image/jpg') return 'image/jpeg';
  return /^image\/(png|jpeg|webp)$/.test(mime) ? mime : 'image/png';
}

async function callVision(url: string, model: string, images: Array<{ content: string; mimeType: string }>, instruction: string, headers: Record<string, string> = {}, timeoutMs = 45_000) {
  // Bionic / LM Studioの互換実装にはdetailフィールドを受け付けないものがあるため、最小形式で送る。
  const content = [{ type: 'text', text: instruction }, ...images.map(image => ({ type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.content}` } }))];
  const response = await fetch(`${url.replace(/\/$/, '')}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ model, temperature: 0, max_tokens: 4096, messages: [{ role: 'user', content }] }), signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(await response.text());
  const result = await response.json() as { choices?: Array<{ message?: { content?: unknown }; text?: unknown }> };
  const choice = result.choices?.[0];
  return parseJson(modelContent(choice?.message?.content ?? choice?.text)) ?? {};
}

const defaultLocalModel = 'google/gemma-4-e4b';

function normalizeGeminiModel(value: string | undefined) {
  return (value ?? '').trim().replace(/^models\//, '') || defaultGeminiModel;
}

async function callGemini(key: string, requestedModel: string, parts: Array<Record<string, unknown>>) {
  const models = Array.from(new Set([normalizeGeminiModel(requestedModel), defaultGeminiModel]));
  let lastError = '';
  for (const model of models) {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0, responseMimeType: 'application/json' } }), signal: AbortSignal.timeout(45_000) });
    if (response.ok) return await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    lastError = await response.text();
    const canTryLatest = response.status === 404 && model !== defaultGeminiModel && /no longer available|not found|NOT_FOUND/i.test(lastError);
    if (!canTryLatest) throw new Error(lastError);
  }
  throw new Error(lastError || 'Gemini model request failed');
}

async function resolveLocalModel(base: string): Promise<string> {
  const configured = process.env.LOCAL_GEMMA_MODEL?.trim();
  if (configured) return configured;
  try {
    const response = await fetch(`${base.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(3_000) });
    if (response.ok) {
      const payload = await response.json() as { data?: Array<{ id?: unknown }> };
      const available = payload.data?.map(item => typeof item.id === 'string' ? item.id.trim() : '').filter(Boolean) ?? [];
      const model = available.find(item => /gemma/i.test(item)) || available[0];
      if (typeof model === 'string') return model.trim();
    }
  } catch { /* モデル一覧がないサーバーは既定名で試す */ }
  return defaultLocalModel;
}

export async function POST(request: Request) {
  let body: Input; try { body = await request.json() as Input; } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }
  const candidates = Array.isArray(body.images) ? body.images : [];
  const images = candidates
    .filter(image => typeof image?.content === 'string' && image.content.length > 0)
    .slice(0, 12)
    .map(image => ({ content: image.content as string, mimeType: normalizeImageMimeType(image.mimeType) }));
  if (!images.length) return NextResponse.json({ error: '写真がありません' }, { status: 400 });
  if (images.some(image => image.content.length > 12_000_000)) return NextResponse.json({ error: '写真のサイズが大きすぎます。1枚12MB以下にしてください。' }, { status: 413 });
  const provider = body.provider === 'api' ? 'api' : 'gemma';
  const mode = body.mode === 'memorize' ? 'memorize' : 'tasks';
  const instruction = mode === 'memorize' ? memorizePrompt : prompt;
  try {
    const tasks: unknown[] = [];
    if (provider === 'api') {
      const key = process.env.GEMINI_API_KEY;
      if (!key) return NextResponse.json({ error: 'GEMINI_API_KEYが未設定です' }, { status: 503 });
      const model = normalizeGeminiModel(process.env.GEMINI_MODEL);
      const parts = [{ text: instruction }, ...images.map(image => ({ inline_data: { mime_type: image.mimeType, data: image.content } }))];
      const result = await callGemini(key, model, parts);
      const parsed = parseJson(result.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
      tasks.push(...(mode === 'memorize' ? cleanCards(parsed?.cards ?? parsed?.items ?? parsed?.vocab ?? parsed?.flashcards) : cleanTasks(parsed?.tasks ?? parsed?.assignments ?? parsed?.items)));
    } else {
      const base = process.env.LOCAL_GEMMA_BASE_URL || 'http://127.0.0.1:1234/v1'; const model = await resolveLocalModel(base);
      const localKey = process.env.LOCAL_GEMMA_API_KEY?.trim();
      // ローカル推論はMacの性能や画像枚数によって時間がかかるため、APIより長めに待つ。
      const parsed = await callVision(base, model, images, instruction, localKey ? { authorization: `Bearer ${localKey}` } : {}, 120_000) as { tasks?: unknown; cards?: unknown; items?: unknown; vocab?: unknown; flashcards?: unknown; assignments?: unknown };
      tasks.push(...(mode === 'memorize' ? cleanCards(parsed.cards ?? parsed.items ?? parsed.vocab ?? parsed.flashcards) : cleanTasks(parsed.tasks ?? parsed.assignments ?? parsed.items)));
    }
    if (mode === 'memorize') { const unique = new Map<string, { front: string; back: string; subject: string }>(); for (const card of cleanCards(tasks)) unique.set(`${card.front}|${card.subject}`.toLowerCase(), card); return NextResponse.json({ cards: Array.from(unique.values()) }); }
    const unique = new Map<string, { title: string; subject: string; dueDate: string; body: string }>(); for (const task of cleanTasks(tasks)) unique.set(`${task.title}|${task.subject}`.toLowerCase(), task);
    return NextResponse.json({ tasks: Array.from(unique.values()) });
  } catch (error) { console.error('SnapTask AI parse failed', { provider, mode, reason: error instanceof Error ? error.message.slice(0, 400) : 'unknown' }); return NextResponse.json({ error: provider === 'gemma' ? gemmaErrorMessage(error) : geminiErrorMessage(error) }, { status: 503 }); }
}

// 公開後の接続確認用。秘密情報やキーの値は返さない。
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get('check') === 'gemma') {
    const base = process.env.LOCAL_GEMMA_BASE_URL || 'http://127.0.0.1:1234/v1';
    try {
      const response = await fetch(`${base.replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(2_500) });
      if (!response.ok) return NextResponse.json({ ok: false, provider: 'gemma', message: 'Gemmaから応答がありません' }, { status: 503 });
      const payload = await response.json().catch(() => null) as { data?: Array<{ id?: unknown }> } | null;
      const available = payload?.data?.map(item => typeof item.id === 'string' ? item.id.trim() : '').filter(Boolean) ?? [];
      const model = process.env.LOCAL_GEMMA_MODEL?.trim() || available.find(item => /gemma/i.test(item)) || available[0] || defaultLocalModel;
      return NextResponse.json({ ok: true, provider: 'gemma', model, message: 'Gemmaに接続できます' });
    } catch { return NextResponse.json({ ok: false, provider: 'gemma', message: 'Gemmaに接続できません' }, { status: 503 }); }
  }
  return NextResponse.json({
    ok: true,
    providers: { gemma: true, api: Boolean(process.env.GEMINI_API_KEY) },
    model: { gemma: process.env.LOCAL_GEMMA_MODEL || defaultLocalModel, api: normalizeGeminiModel(process.env.GEMINI_MODEL) },
  });
}
