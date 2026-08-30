'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { AuthSession, deleteRemotePhoto, fetchRemoteData, hydrateRemotePhotoUrls, isSupabaseConfigured, readGoogleSessionFromUrl, refreshSession, saveRemoteData, signOut, startGoogleSignIn, uploadRemotePhoto } from '../lib/supabase';

type Task = { id: string; title: string; subject: string; dueDate: string; body: string; estimatedMinutes?: number; done: boolean };
type SavedPhoto = { id: string; name: string; dataUrl: string; createdAt: string; kind: 'task' | 'memory'; storagePath?: string; remoteUrl?: string };
type Vocab = { id: string; term: string; meaning: string; subject: string };
type UserProfile = { id: string; displayName: string; email: string; createdAt: string };
type Activity = Record<string, { completed: number; answered?: number; wrong?: number }>;
type ApiUsage = { month: string; count: number };
type Screen = 'home' | 'add' | 'english' | 'share' | 'photos' | 'account';
type Provider = 'gemma' | 'api';
type MemoryMode = 'list' | 'flash' | 'quiz';
type GemmaStatus = 'unknown' | 'checking' | 'ready' | 'offline';
type ApiConfigStatus = 'unknown' | 'ready' | 'missing';
type WorkspaceResult = { kind: 'task' | 'deck' | 'card'; title: string; subtitle: string; subject?: string };

const starterTasks: Task[] = [
  { id: 'task-1', title: '数学ワーク p.24〜27', subject: '数学', dueDate: '2026-08-30', body: '問題を解いて提出する', estimatedMinutes: 30, done: false },
  { id: 'task-2', title: '英語 長文プリント', subject: '英語', dueDate: '2026-09-02', body: '本文を読み、設問に答える', estimatedMinutes: 40, done: false },
];
const starterVocab: Vocab[] = [
  { id: 'v-1', term: 'available', meaning: '利用できる、手に入る', subject: '英語' },
  { id: 'v-2', term: 'take part in ～', meaning: '～に参加する', subject: '英語' },
  { id: 'v-3', term: 'in advance', meaning: '前もって、あらかじめ', subject: '英語' },
  { id: 'v-4', term: 'reduce', meaning: '減らす、縮小する', subject: '英語' },
];
const defaultDeckNames = ['英語'];
const tutorialSteps = [
  { label: '撮る', title: 'プリントや黒板を追加', body: '「追加」から写真を選ぶだけ。HEIC・JPGは自動でPNGに変換して読み取ります。' },
  { label: '整える', title: '読み取り結果を確認', body: 'AIの結果は保存前に編集できます。誤読がないか、課題名や締切をチェックしましょう。' },
  { label: '続ける', title: '課題と暗記を毎日記録', body: '完了チェックや4択テストで学習すると、ホームのカレンダーに記録されます。' },
  { label: '振り返る', title: 'ミスを復習・共有', body: '間違えたカードだけの復習や、単語帳の共有もいつでも使えます。' },
] as const;
const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const GEMINI_FREE_LIMIT = 20;
const GEMINI_PREMIUM_LIMIT = 300;
const PREMIUM_STORAGE_KEY = 'snaptask-premium-v1';
const PHOTOS_STORAGE_KEY = 'snaptask-photos-v1';
const PROFILE_STORAGE_KEY = 'snaptask-profile-v1';
const AUTH_STORAGE_KEY = 'snaptask-auth-session-v1';

function newId(prefix: string) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function monthKey(date: Date) { return dateKey(date).slice(0, 7); }
function shiftedDate(key: string, offset: number) { const date = new Date(`${key}T12:00:00`); date.setDate(date.getDate() + offset); return dateKey(date); }
function demoTasksFor(today: string): Task[] { return [
  { id: 'task-1', title: '数学ワーク p.24〜27', subject: '数学', dueDate: shiftedDate(today, 2), body: '問題を解いて提出する', estimatedMinutes: 30, done: false },
  { id: 'task-2', title: '英語 長文プリント', subject: '英語', dueDate: shiftedDate(today, 5), body: '本文を読み、設問に答える', estimatedMinutes: 40, done: false },
]; }
function formatDue(value: string) { if (!value) return '締切未設定'; const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : `${date.getMonth() + 1}/${date.getDate()}(${weekdays[date.getDay()]})`; }
function formatDay(key: string) { const date = new Date(`${key}T12:00:00`); return `${date.getMonth() + 1}/${date.getDate()}`; }
function dueTone(value: string, today: string) { if (!value || !today) return 'unset'; const diff = Math.round((new Date(`${value}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000); return diff < 0 ? 'overdue' : diff <= 1 ? 'urgent' : diff <= 3 ? 'soon' : 'normal'; }
function dueHint(value: string, today: string) { if (!value || !today) return ''; const diff = Math.round((new Date(`${value}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000); return diff < 0 ? '期限超過' : diff === 0 ? '今日' : diff === 1 ? '明日' : `あと${diff}日`; }
function recordOf(value: unknown): Record<string, unknown> { return typeof value === 'object' && value !== null ? value as Record<string, unknown> : {}; }
function safeCount(value: unknown) { const number = Number(value); return Number.isFinite(number) && number > 0 ? Math.round(number) : 0; }
function safeMinutes(value: unknown) { const number = Number(value); return Number.isFinite(number) && number > 0 ? Math.min(600, Math.round(number)) : 0; }
function normalizeTasks(value: unknown): Task[] { if (!Array.isArray(value)) return []; return value.map((item, index) => { const row = recordOf(item); const estimatedMinutes = safeMinutes(row.estimatedMinutes ?? row.duration ?? row.minutes); return { id: String(row.id ?? `task-${index + 1}`), title: String(row.title ?? '').trim(), subject: String(row.subject ?? '教科未設定').trim() || '教科未設定', dueDate: String(row.dueDate ?? '').trim(), body: String(row.body ?? '').trim(), ...(estimatedMinutes ? { estimatedMinutes } : {}), done: row.done === true }; }).filter(task => task.title); }
function normalizeVocab(value: unknown): Vocab[] { if (!Array.isArray(value)) return []; return value.map((item, index) => { const row = recordOf(item); return { id: String(row.id ?? `vocab-${index + 1}`), term: String(row.term ?? '').trim(), meaning: String(row.meaning ?? '').trim(), subject: String(row.subject ?? row.deck ?? 'その他').trim() || 'その他' }; }).filter(card => card.term && card.meaning); }
function normalizeActivity(value: unknown): Activity { if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}; return Object.fromEntries(Object.entries(value).map(([key, raw]) => { const row = recordOf(raw); return [key, { completed: safeCount(row.completed), answered: safeCount(row.answered), wrong: safeCount(row.wrong) }]; })); }
function normalizeWrongIds(value: unknown) { return Array.isArray(value) ? Array.from(new Set(value.map(String).filter(Boolean))) : []; }
function normalizePhotos(value: unknown): SavedPhoto[] { if (!Array.isArray(value)) return []; return value.map((item, index) => { const row = recordOf(item); const kind: SavedPhoto['kind'] = row.kind === 'memory' ? 'memory' : 'task'; const storagePath = String(row.storagePath ?? '').trim(); return { id: String(row.id ?? `photo-${index + 1}`), name: String(row.name ?? '撮影した写真').trim() || '撮影した写真', dataUrl: String(row.dataUrl ?? ''), createdAt: String(row.createdAt ?? ''), kind, ...(storagePath ? { storagePath } : {}), ...(String(row.remoteUrl ?? '').trim() ? { remoteUrl: String(row.remoteUrl).trim() } : {}) }; }).filter(photo => photo.dataUrl || photo.storagePath); }
function normalizeProfile(value: unknown): UserProfile | null { const row = recordOf(value); const displayName = String(row.displayName ?? '').trim(); const email = String(row.email ?? '').trim().toLocaleLowerCase(); if (!displayName || !email || !/^\S+@\S+\.\S+$/.test(email)) return null; return { id: String(row.id ?? newId('user')), displayName, email, createdAt: String(row.createdAt ?? new Date().toISOString()) }; }
function normalizeApiUsage(value: unknown, month: string): ApiUsage { const row = recordOf(value); return { month, count: row.month === month ? Math.min(GEMINI_PREMIUM_LIMIT, safeCount(row.count)) : 0 }; }
function taskKey(task: Pick<Task, 'title' | 'subject' | 'dueDate'>) { return `${task.title.trim().toLocaleLowerCase()}|${task.subject.trim().toLocaleLowerCase()}|${task.dueDate}`; }
function mergeTasks(existing: Task[], incoming: Task[]) { const seen = new Set(existing.map(taskKey)); const unique = incoming.filter(task => { const key = taskKey(task); if (seen.has(key)) return false; seen.add(key); return true; }); return [...existing, ...unique]; }
function vocabKey(card: Pick<Vocab, 'term' | 'subject'>) { return `${card.subject.trim().toLocaleLowerCase()}|${card.term.trim().toLocaleLowerCase()}`; }
function mergeVocab(existing: Vocab[], incoming: Vocab[]) { const seen = new Set(existing.map(vocabKey)); const unique = incoming.filter(card => { const key = vocabKey(card); if (seen.has(key)) return false; seen.add(key); return true; }); return [...existing, ...unique]; }
function deckArtPath(subject: string) {
  if (/英語|english/i.test(subject)) return '/deck-art/english.jpg';
  if (/数学|math/i.test(subject)) return '/deck-art/math.jpg';
  if (/理科|science|化学|物理|生物/i.test(subject)) return '/deck-art/science.jpg';
  if (/社会|地理|歴史|公民|social|history/i.test(subject)) return '/deck-art/social.jpg';
  if (/国語|古文|漢文|literature|japanese/i.test(subject)) return '/deck-art/japanese.jpg';
  return '/deck-art/other.jpg';
}
function encodeShareData(value: string) { const bytes = new TextEncoder().encode(value); let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, ''); }
function decodeShareData(value: string) { const normalized = value.replaceAll('-', '+').replaceAll('_', '/'); const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4); const binary = atob(padded); return new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0))); }
function readPremiumActive() { try { return typeof window !== 'undefined' && localStorage.getItem(PREMIUM_STORAGE_KEY) === '1'; } catch { return false; } }
function authErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : '';
  if (/email address .*invalid|invalid email/i.test(message)) return 'メールアドレスを確認してね。半角英数字で、空白なしで入力してください。';
  if (/rate limit exceeded|email.*rate.?limit|over_email_send_rate_limit|too many requests/i.test(message)) return '確認メールの送信上限に達しました。しばらく待ってから再試行してね。登録済みなら「ログイン」を使ってください。';
  if (/email not confirmed|email_not_confirmed/i.test(message)) return '確認メールのリンクを開いてからログインしてね。メールが届かない場合は迷惑メールも確認してください。';
  if (/invalid login credentials|invalid.*credentials|invalid password/i.test(message)) return 'メールアドレスまたはパスワードが違います。確認メールのリンクを開いたか、入力内容を確認してね。';
  if (/not authorized|メール.*送信/i.test(message)) return '確認メールを送れませんでした。Supabaseのメール設定を確認してください。';
  if (/already registered|user already/i.test(message)) return 'このメールアドレスは登録済みです。「ログイン」に切り替えてね。';
  return message || '認証に失敗しました。';
}

async function toPng(file: File): Promise<File> {
  let source: Blob = file;
  if (/\.(heic|heif)$/i.test(file.name) || /image\/(heic|heif)/i.test(file.type)) {
    try {
      const heic2any = (await import('heic2any')).default;
      const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: .94 });
      source = Array.isArray(converted) ? converted[0] : converted;
    } catch {
      throw new Error('HEIC画像を変換できませんでした。iPhoneの共有設定で「互換性優先」を選ぶか、写真をJPEGで保存してから再試行してね。');
    }
  }
  let bitmap: ImageBitmap | null = null;
  let image: HTMLImageElement | null = null;
  if (typeof createImageBitmap === 'function') {
    try { bitmap = await createImageBitmap(source); } catch { /* SafariなどではImage要素へフォールバック */ }
  }
  if (!bitmap) {
    const objectUrl = URL.createObjectURL(source);
    image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image();
      element.onload = () => { URL.revokeObjectURL(objectUrl); resolve(element); };
      element.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('画像を読み込めません')); };
      element.src = objectUrl;
    });
  }
  const width = bitmap?.width ?? image?.naturalWidth ?? 0;
  const height = bitmap?.height ?? image?.naturalHeight ?? 0;
  const sourceImage: CanvasImageSource | null = bitmap ?? image;
  if (!sourceImage || !width || !height) throw new Error('画像サイズを取得できません');
  const scale = Math.min(1, 2200 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画像を変換できません');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(sourceImage, 0, 0, canvas.width, canvas.height); bitmap?.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG変換に失敗しました')), 'image/png'));
  return new File([blob], file.name.replace(/\.(heic|heif|jpe?g)$/i, '.png'), { type: 'image/png' });
}
function dataUrl(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); }
async function toApiImage(png: File): Promise<File> {
  const objectUrl = URL.createObjectURL(png);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new window.Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('画像を圧縮できません'));
      element.src = objectUrl;
    });
    const scale = Math.min(1, 1600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('画像を圧縮できません');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('画像を圧縮できません')), 'image/jpeg', .8));
    return new File([blob], png.name.replace(/\.png$/i, '.jpg'), { type: 'image/jpeg' });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
async function readApiResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text.trim()) throw new Error(response.ok ? '解析結果が空でした。もう一度試してね。' : `解析サーバーエラー（${response.status}）`);
  try { return JSON.parse(text) as T; } catch {
    if (response.status === 413 || /request entity too large|payload too large|request body too large|too large/i.test(text)) {
      throw new Error('画像の送信サイズが大きすぎます。写真を少し減らしてもう一度試してね。');
    }
    throw new Error(response.ok ? '解析結果を読み取れませんでした。もう一度試してね。' : `解析サーバーエラー（${response.status}）。しばらくしてから再試行してね。`);
  }
}
function assertApiImageSize(images: Array<{ content: string }>) {
  const total = images.reduce((sum, image) => sum + image.content.length, 0);
  if (total > 3_400_000) throw new Error('画像の合計サイズが大きすぎます。写真を2〜3枚ずつに分けて試してね。');
}
function thumbnailDataUrl(file: File) { return new Promise<string>((resolve, reject) => { const objectUrl = URL.createObjectURL(file); const image = new window.Image(); image.onload = () => { const scale = Math.min(1, 1000 / Math.max(image.naturalWidth, image.naturalHeight)); const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale)); const context = canvas.getContext('2d'); if (!context) { URL.revokeObjectURL(objectUrl); reject(new Error('サムネイルを作成できません')); return; } context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height); URL.revokeObjectURL(objectUrl); resolve(canvas.toDataURL('image/jpeg', .78).split(',')[1] ?? ''); }; image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('サムネイルを作成できません')); }; image.src = objectUrl; }); }

function speakText(text: string) {
  if (typeof window === 'undefined' || !('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  const isEnglish = /[A-Za-z]/.test(text) && !/[ぁ-んァ-ン一-龯]/.test(text);
  utterance.lang = isEnglish ? 'en-US' : 'ja-JP';
  utterance.rate = isEnglish ? .82 : .95;
  const voice = window.speechSynthesis.getVoices().find(item => isEnglish ? /^en(-|_)/i.test(item.lang) : /^ja(-|_)/i.test(item.lang));
  if (voice) utterance.voice = voice;
  window.speechSynthesis.speak(utterance);
  return true;
}

function SpeechButton({ text }: { text: string }) {
  const [unavailable, setUnavailable] = useState(false);
  return <button type="button" className="speech-button" aria-label={`${text}を読み上げ`} title="発音を聞く" onClick={event => { event.stopPropagation(); if (!speakText(text)) setUnavailable(true); }}>{unavailable ? '−' : '🔊'}</button>;
}

function FlashStudyPanel({ cards, index, known, revealed, finished, onReveal, onAnswer, onRestart, onClose }: { cards: Vocab[]; index: number; known: number; revealed: boolean; finished: boolean; onReveal: () => void; onAnswer: (known: boolean) => void; onRestart: () => void; onClose: () => void }) {
  const card = cards[index];
  return <div className="flash-panel" role="dialog" aria-modal="true" aria-label="一周学習"><button className="flash-close" onClick={onClose}>× 閉じる</button>
    {finished ? <div className="quiz-result"><p className="kicker">ROUND COMPLETE</p><strong>{known}/{cards.length}</strong><p>一周完了！覚えたカードは {known} 枚。もう一度にしたカードは「まちがい」に残っています。</p><button onClick={onRestart}>もう一度学習</button></div> : card ? <><div className="quiz-progress"><span>{index + 1} / {cards.length}枚</span><span>覚えた {known}</span></div><div className="flash-card"><div className="flash-term-row"><p className="flash-term">{card.term}</p><SpeechButton text={card.term} /></div>{revealed ? <div className="flash-answer"><p>{card.meaning}</p><div className="flash-actions"><button onClick={() => onAnswer(false)}>もう一度</button><button onClick={() => onAnswer(true)}>覚えた</button></div></div> : <button className="reveal-button" onClick={onReveal}>説明を見る</button>}</div></> : <div className="empty-state"><b>カードがありません</b><span>先に暗記カードを追加しよう。</span></div>}
  </div>;
}

function MoveCardPanel({ cards, decks, onMove, onClose }: { cards: Vocab[]; decks: string[]; onMove: (id: string, subject: string) => void; onClose: () => void }) {
  return <div className="move-panel" role="dialog" aria-modal="true" aria-label="カードを整理"><button className="flash-close" onClick={onClose}>× 閉じる</button><p className="kicker">ORGANIZE</p><h2>カードを単語帳に整理</h2><p className="move-intro">教科を選ぶと、カードがその単語帳へ移動します。</p><div className="move-list">{cards.length ? cards.map(card => <div className="move-row" key={card.id}><div><b>{card.term}</b><small>{card.meaning}</small></div><select aria-label={`${card.term}の単語帳`} value={card.subject} onChange={event => onMove(card.id, event.target.value)}>{decks.map(item => <option key={item} value={item}>{item}</option>)}</select></div>) : <div className="empty-state"><b>整理できるカードがありません</b><span>先に暗記カードを追加しよう。</span></div>}</div></div>;
}

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [screen, setScreen] = useState<Screen>('home');
  const [tasks, setTasks] = useState<Task[]>(starterTasks); const [vocab, setVocab] = useState<Vocab[]>(starterVocab); const [activity, setActivity] = useState<Activity>({}); const [photos, setPhotos] = useState<SavedPhoto[]>([]); const [selectedPhoto, setSelectedPhoto] = useState<SavedPhoto | null>(null); const [profile, setProfile] = useState<UserProfile | null>(null);
  const [todayKey, setTodayKey] = useState(''); const [selectedDay, setSelectedDay] = useState(''); const [weeklyGoal, setWeeklyGoal] = useState(5); const [provider, setProvider] = useState<Provider>('gemma'); const [apiUsage, setApiUsage] = useState<ApiUsage>({ month: '', count: 0 }); const [premiumActive, setPremiumActive] = useState(readPremiumActive);
  const [reading, setReading] = useState(false); const [message, setMessage] = useState(''); const [fileName, setFileName] = useState(''); const [taskReadHint, setTaskReadHint] = useState('');
  const [memoryReading, setMemoryReading] = useState(false); const [memoryMessage, setMemoryMessage] = useState(''); const [memoryFileName, setMemoryFileName] = useState(''); const [memoryReadHint, setMemoryReadHint] = useState('');
  const [cameraMessage, setCameraMessage] = useState('');
  const [draftTasks, setDraftTasks] = useState<Task[]>([]); const [subject, setSubject] = useState('すべて'); const [showDone, setShowDone] = useState(false); const [taskQuery, setTaskQuery] = useState('');
  const [deck, setDeck] = useState('英語'); const [term, setTerm] = useState(''); const [meaning, setMeaning] = useState(''); const [englishMessage, setEnglishMessage] = useState(''); const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [memoryMode, setMemoryMode] = useState<MemoryMode>('list'); const [reviewWrongOnly, setReviewWrongOnly] = useState(false); const [wrongIds, setWrongIds] = useState<string[]>([]); const [quizReviewOnly, setQuizReviewOnly] = useState(false); const [quizRoundIds, setQuizRoundIds] = useState<string[]>([]); const [quizIndex, setQuizIndex] = useState(0); const [quizScore, setQuizScore] = useState(0); const [quizSelected, setQuizSelected] = useState<string | null>(null); const [quizFinished, setQuizFinished] = useState(false); const [quizShuffleSeed, setQuizShuffleSeed] = useState(0); const [flashIndex, setFlashIndex] = useState(0); const [flashKnown, setFlashKnown] = useState(0); const [flashRevealed, setFlashRevealed] = useState(false); const [flashFinished, setFlashFinished] = useState(false);
  const [showGuide, setShowGuide] = useState(true); const [tutorialStep, setTutorialStep] = useState(0); const [backupMessage, setBackupMessage] = useState('');
  const [manualTitle, setManualTitle] = useState(''); const [manualSubject, setManualSubject] = useState(''); const [manualDue, setManualDue] = useState(''); const [manualBody, setManualBody] = useState(''); const [manualMinutes, setManualMinutes] = useState(''); const [manualMessage, setManualMessage] = useState('');
  const [focusMinutes, setFocusMinutes] = useState(30);
  const [shareDeck, setShareDeck] = useState(''); const [shareMessage, setShareMessage] = useState(''); const [deckNames, setDeckNames] = useState<string[]>(defaultDeckNames);
  const [manageOpen, setManageOpen] = useState(false); const [apiConfigStatus, setApiConfigStatus] = useState<ApiConfigStatus>('unknown'); const [billingOpen, setBillingOpen] = useState(false); const [billingError, setBillingError] = useState(''); const [billingLoading, setBillingLoading] = useState(false);
  const [gemmaStatus, setGemmaStatus] = useState<GemmaStatus>('unknown');
  const [workspaceQuery, setWorkspaceQuery] = useState(''); const [workspaceSearchOpen, setWorkspaceSearchOpen] = useState(false);
  const [profileEmail, setProfileEmail] = useState('');
  const [authSession, setAuthSession] = useState<AuthSession | null>(null); const [authBusy, setAuthBusy] = useState(false); const [authMessage, setAuthMessage] = useState(''); const [syncMessage, setSyncMessage] = useState(''); const [authHydrated, setAuthHydrated] = useState(false);
  const [isPublicApp, setIsPublicApp] = useState(false);
  const providerTouched = useRef(false);
  const authSessionRef = useRef<AuthSession | null>(null);
  const taskPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const memoryPhotoInputRef = useRef<HTMLInputElement | null>(null);
  const taskCameraInputRef = useRef<HTMLInputElement | null>(null);
  const memoryCameraInputRef = useRef<HTMLInputElement | null>(null);
  const supabaseReady = isSupabaseConfigured();

  function selectProvider(next: Provider) { if (isPublicApp && next === 'gemma') return; providerTouched.current = true; setProvider(next); }

  function saveTasks(next: Task[]) { setTasks(next); localStorage.setItem('snaptask-tasks', JSON.stringify(next)); }
  function saveVocab(next: Vocab[]) { setVocab(next); localStorage.setItem('snaptask-vocab', JSON.stringify(next)); }
  function savePhotos(next: SavedPhoto[]) { const capped = next.slice(-40); setPhotos(capped); try { localStorage.setItem(PHOTOS_STORAGE_KEY, JSON.stringify(capped)); } catch { const trimmed = capped.slice(-12); setPhotos(trimmed); try { localStorage.setItem(PHOTOS_STORAGE_KEY, JSON.stringify(trimmed)); } catch { /* 保存領域がない場合も解析結果は維持 */ } } }
  function saveDeckNames(next: string[]) { const unique = Array.from(new Set(next.map(name => name.trim()).filter(Boolean))); setDeckNames(unique); localStorage.setItem('snaptask-decks', JSON.stringify(unique)); }
  function recordCompleted(delta: number) { const key = todayKey || dateKey(new Date()); setActivity(current => { const day = current[key] ?? { completed: 0 }; const next = { ...current, [key]: { ...day, completed: Math.max(0, (day.completed ?? 0) + delta) } }; localStorage.setItem('snaptask-activity', JSON.stringify(next)); return next; }); }
  function recordQuizAnswer(correct: boolean) { const key = todayKey || dateKey(new Date()); setActivity(current => { const day = current[key] ?? { completed: 0 }; const next = { ...current, [key]: { ...day, answered: (day.answered ?? 0) + 1, wrong: (day.wrong ?? 0) + (correct ? 0 : 1) } }; localStorage.setItem('snaptask-activity', JSON.stringify(next)); return next; }); }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const currentDate = dateKey(new Date());
      setTodayKey(currentDate);
      setSelectedDay(currentDate);
      const publicApp = window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';
      setIsPublicApp(publicApp);
      if (publicApp) { providerTouched.current = true; setProvider('api'); }
      try {
        const usage = normalizeApiUsage(JSON.parse(localStorage.getItem('snaptask-api-usage') ?? 'null'), monthKey(new Date())); setApiUsage(usage); localStorage.setItem('snaptask-api-usage', JSON.stringify(usage));
        const demoMode = new URLSearchParams(window.location.search).get('demo') === '1';
        if (demoMode) {
          const nextTasks = demoTasksFor(currentDate);
          setTasks(nextTasks); setVocab([...starterVocab]); setDeckNames([...defaultDeckNames]); setActivity({}); setWrongIds([]); setWeeklyGoal(5); setTutorialStep(0); setShowGuide(true);
          localStorage.setItem('snaptask-tasks', JSON.stringify(nextTasks)); localStorage.setItem('snaptask-vocab', JSON.stringify(starterVocab)); localStorage.setItem('snaptask-decks', JSON.stringify(defaultDeckNames)); localStorage.setItem('snaptask-activity', '{}'); localStorage.setItem('snaptask-wrong-cards', '[]'); localStorage.setItem('snaptask-weekly-goal', '5');
        } else {
          const savedTasks = JSON.parse(localStorage.getItem('snaptask-tasks') ?? 'null'); if (Array.isArray(savedTasks)) setTasks(normalizeTasks(savedTasks)); else setTasks(demoTasksFor(currentDate));
          const savedWords = JSON.parse(localStorage.getItem('snaptask-vocab') ?? 'null'); if (Array.isArray(savedWords)) setVocab(normalizeVocab(savedWords));
          const savedDecks = JSON.parse(localStorage.getItem('snaptask-decks') ?? 'null'); if (Array.isArray(savedDecks)) setDeckNames(Array.from(new Set(savedDecks.map(String).map(name => name.trim()).filter(Boolean))));
          const savedActivity = JSON.parse(localStorage.getItem('snaptask-activity') ?? 'null'); if (savedActivity && typeof savedActivity === 'object') setActivity(normalizeActivity(savedActivity));
          const savedPhotos = JSON.parse(localStorage.getItem(PHOTOS_STORAGE_KEY) ?? 'null'); if (Array.isArray(savedPhotos)) setPhotos(normalizePhotos(savedPhotos));
          const savedWrong = JSON.parse(localStorage.getItem('snaptask-wrong-cards') ?? 'null'); if (Array.isArray(savedWrong)) setWrongIds(normalizeWrongIds(savedWrong));
          const savedGoal = Number(localStorage.getItem('snaptask-weekly-goal')); if (Number.isFinite(savedGoal) && savedGoal > 0) setWeeklyGoal(savedGoal);
          const savedProfile = normalizeProfile(JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) ?? 'null')); if (savedProfile) { setProfile(savedProfile); setProfileEmail(savedProfile.email); }
          setShowGuide(localStorage.getItem('snaptask-guide-seen') !== '1');
        }
      } catch { setTasks(demoTasksFor(currentDate)); /* 壊れた保存データでもデモ画面を維持 */ }
      setMounted(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function hydrateRemoteSession(session: AuthSession) {
    authSessionRef.current = session;
    setAuthSession(session);
    if (session.user.email) setProfileEmail(session.user.email);
    void fetch('/api/billing/status', { headers: { Authorization: `Bearer ${session.access_token}` } }).then(response => response.ok ? response.json() as Promise<{ active?: boolean }> : null).then(result => { if (result?.active) { setPremiumActive(true); localStorage.setItem(PREMIUM_STORAGE_KEY, '1'); } }).catch(() => { /* 契約確認に失敗しても学習同期は続ける */ });
    try {
      const remote = await fetchRemoteData(session);
      const data = recordOf(remote);
      if (remote && (Array.isArray(data.tasks) || Array.isArray(data.vocab))) {
        const nextTasks = normalizeTasks(data.tasks); const nextVocab = normalizeVocab(data.vocab); const storedDecks = Array.isArray(data.deckNames) ? data.deckNames.map(String).map(name => name.trim()).filter(Boolean) : [];
        const nextDecks = Array.from(new Set([...storedDecks, ...nextVocab.map(card => card.subject)])); const nextActivity = normalizeActivity(data.activity); const nextWrongIds = normalizeWrongIds(data.wrongIds); const nextGoal = Number(data.weeklyGoal);
        const storedPhotos = normalizePhotos(data.photos); const remotePhotos = storedPhotos.filter(photo => photo.storagePath).map(photo => ({ id: photo.id, name: photo.name, kind: photo.kind, createdAt: photo.createdAt, storagePath: photo.storagePath as string })); const hydratedRemotePhotos = await hydrateRemotePhotoUrls(session, remotePhotos); const remoteUrls = new Map(hydratedRemotePhotos.map(photo => [photo.id, photo.remoteUrl])); const nextPhotos = storedPhotos.map(photo => ({ ...photo, remoteUrl: remoteUrls.get(photo.id) ?? photo.remoteUrl })); setTasks(nextTasks); setVocab(nextVocab); setDeckNames(nextDecks.length ? nextDecks : defaultDeckNames); setActivity(nextActivity); setWrongIds(nextWrongIds); if (nextPhotos.length) setPhotos(nextPhotos); if (Number.isFinite(nextGoal) && nextGoal > 0) setWeeklyGoal(nextGoal);
        localStorage.setItem('snaptask-tasks', JSON.stringify(nextTasks)); localStorage.setItem('snaptask-vocab', JSON.stringify(nextVocab)); localStorage.setItem('snaptask-decks', JSON.stringify(nextDecks.length ? nextDecks : defaultDeckNames)); localStorage.setItem('snaptask-activity', JSON.stringify(nextActivity)); localStorage.setItem('snaptask-wrong-cards', JSON.stringify(nextWrongIds)); if (Number.isFinite(nextGoal) && nextGoal > 0) localStorage.setItem('snaptask-weekly-goal', String(nextGoal));
        setSyncMessage('クラウドの学習データを読み込みました。');
      } else setSyncMessage('このアカウントにデータを保存していきます。');
    } catch (error) { setSyncMessage(error instanceof Error ? error.message : '同期に接続できませんでした。'); }
    setAuthHydrated(true);
  }

  useEffect(() => {
    if (!mounted) return;
    try {
      const saved = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) ?? 'null') as AuthSession | null;
      if (!saved?.access_token || !saved.user?.id) { queueMicrotask(() => setAuthHydrated(true)); return; }
      if (saved.refresh_token && saved.expires_at && saved.expires_at < Math.floor(Date.now() / 1000) + 60) {
        void refreshSession(saved.refresh_token).then(next => { localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next)); return hydrateRemoteSession(next); }).catch(() => { localStorage.removeItem(AUTH_STORAGE_KEY); setAuthHydrated(true); });
      } else window.setTimeout(() => { void hydrateRemoteSession(saved); }, 0);
    } catch { queueMicrotask(() => setAuthHydrated(true)); }
  }, [mounted]);

  useEffect(() => {
    if (!mounted || !supabaseReady) return;
    let cancelled = false;
    void readGoogleSessionFromUrl().then(async next => {
      if (!next || cancelled) return;
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next));
      await hydrateRemoteSession(next);
      if (!cancelled) { setScreen('account'); setAuthMessage('Googleでログインしました。'); }
    }).catch(error => {
      if (!cancelled) { setAuthMessage(authErrorMessage(error)); setAuthHydrated(true); }
    });
    return () => { cancelled = true; };
  }, [mounted, supabaseReady]);

  useEffect(() => {
    if (!mounted || !authSession || !authHydrated) return;
    const timer = window.setTimeout(() => {
      const syncPhotos = photos.slice(-12).map(photo => ({ ...photo, dataUrl: photo.storagePath ? '' : photo.dataUrl, remoteUrl: undefined }));
      void saveRemoteData(authSession, { tasks, vocab, deckNames, activity, weeklyGoal, wrongIds, photos: syncPhotos }).then(() => setSyncMessage('クラウドに同期しました。')).catch(() => setSyncMessage('同期に失敗しました。次回もう一度試します。'));
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [mounted, authSession, authHydrated, tasks, vocab, deckNames, activity, weeklyGoal, wrongIds, photos]);

  useEffect(() => {
    if (!mounted) return;
    try {
      const params = new URLSearchParams(window.location.search);
      const sessionId = params.get('session_id');
      if (params.get('checkout') === 'success' && sessionId) {
        void fetch(`/api/billing/session?session_id=${encodeURIComponent(sessionId)}`)
          .then(response => response.ok ? response.json() as Promise<{ active?: boolean }> : null)
          .then(result => { if (result?.active) { setPremiumActive(true); localStorage.setItem(PREMIUM_STORAGE_KEY, '1'); } })
          .catch(() => { /* 決済確認に失敗しても学習データは保持 */ })
          .finally(() => { setBillingLoading(false); window.history.replaceState(null, '', `${window.location.pathname}${window.location.hash}`); });
      }
    } catch { /* localStorage may be unavailable */ }
  }, [mounted]);

  // 公開環境ではサーバー側のAPI設定を優先し、ローカル開発ではGemmaを初期選択にする。
  // 画面が表示されるまでに確認するので、ユーザーが手動で選んだ設定を後から上書きしない。
  useEffect(() => {
    if (!mounted) return;
    let active = true;
    void fetch('/api/parse')
      .then(response => response.ok ? response.json() as Promise<{ providers?: { api?: boolean } }> : null)
      .then(payload => { if (!active) return; const configured = payload?.providers?.api === true; setApiConfigStatus(configured ? 'ready' : 'missing'); if (!providerTouched.current && configured) setProvider('api'); })
      .catch(() => { /* 接続確認は任意。ローカルGemmaをそのまま使う */ });
    return () => { active = false; };
  }, [mounted]);

  useEffect(() => {
    if (!mounted || provider !== 'gemma' || (screen !== 'add' && screen !== 'english')) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void fetch('/api/parse?check=gemma')
        .then(response => { if (active) setGemmaStatus(response.ok ? 'ready' : 'offline'); })
        .catch(() => { if (active) setGemmaStatus('offline'); });
    }, 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [mounted, provider, screen]);

  useEffect(() => {
    if (!mounted) return;
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === 'k') {
        event.preventDefault();
        setWorkspaceSearchOpen(current => !current);
      }
      if (event.key === 'Escape') setWorkspaceSearchOpen(false);
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, [mounted]);

  useEffect(() => {
    if (!mounted || !window.location.hash.startsWith('#share=')) return;
    const timer = window.setTimeout(() => {
      try {
        const data = recordOf(JSON.parse(decodeShareData(window.location.hash.slice('#share='.length))));
        const name = String(data.deck ?? '共有ページ').trim() || '共有ページ';
        const rawCards = Array.isArray(data.cards) ? data.cards : [];
        const parsed = normalizeVocab(rawCards.map(card => ({ ...recordOf(card), subject: name }))).map(card => ({ ...card, id: newId('vocab'), subject: name }));
        if (!parsed.length) throw new Error('カードが見つかりません');
        const merged = mergeVocab(vocab, parsed);
        saveVocab(merged); setDeckNames(current => { const next = Array.from(new Set([...current, name])); localStorage.setItem('snaptask-decks', JSON.stringify(next)); return next; });
        const added = merged.length - vocab.length;
        setDeck(name); setShareDeck(name); setScreen('share');
        setShareMessage(added ? `${name}を${added}件取り込みました。` : `${name}はすでに取り込み済みです。`);
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      } catch {
        setScreen('share');
        setShareMessage('共有リンクを読み込めませんでした。');
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [mounted, vocab]);

  const sortedTasks = useMemo(() => { const query = taskQuery.trim().toLocaleLowerCase(); return tasks.filter(task => (showDone || !task.done) && (subject === 'すべて' || task.subject === subject) && (!query || `${task.title} ${task.subject} ${task.body}`.toLocaleLowerCase().includes(query))).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')); }, [tasks, showDone, subject, taskQuery]);
  const todayTasks = useMemo(() => {
    const current = todayKey || dateKey(new Date());
    const urgency = (task: Task) => {
      if (!task.dueDate) return 4;
      const diff = Math.round((new Date(`${task.dueDate}T12:00:00`).getTime() - new Date(`${current}T12:00:00`).getTime()) / 86400000);
      return diff < 0 ? 0 : diff === 0 ? 1 : diff <= 3 ? 2 : 3;
    };
    return tasks.filter(task => !task.done).sort((a, b) => urgency(a) - urgency(b) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999')).slice(0, 5);
  }, [tasks, todayKey]);
  const recommendedTask = useMemo(() => todayTasks.find(task => !task.estimatedMinutes || task.estimatedMinutes <= focusMinutes) ?? todayTasks[0] ?? null, [todayTasks, focusMinutes]);
  const subjects = useMemo(() => ['すべて', ...Array.from(new Set(tasks.map(task => task.subject).filter(Boolean)))], [tasks]);
  const decks = Array.from(new Set([...deckNames, ...vocab.map(item => item.subject)]));
  const shareableDecks = decks.filter(name => vocab.some(card => card.subject === name));
  const workspaceResults: WorkspaceResult[] = (() => {
    const query = workspaceQuery.trim().toLocaleLowerCase();
    if (!query) return [];
    const taskResults = tasks.filter(task => `${task.title} ${task.subject} ${task.body}`.toLocaleLowerCase().includes(query)).slice(0, 5).map(task => ({ kind: 'task' as const, title: task.title, subtitle: `${task.subject} · ${formatDue(task.dueDate)}` }));
    const deckResults = decks.filter(name => name.toLocaleLowerCase().includes(query)).slice(0, 5).map(name => ({ kind: 'deck' as const, title: name, subtitle: `${vocab.filter(card => card.subject === name).length}項目の暗記ページ` }));
    const cardResults = vocab.filter(card => `${card.term} ${card.meaning} ${card.subject}`.toLocaleLowerCase().includes(query)).slice(0, 6).map(card => ({ kind: 'card' as const, title: card.term, subtitle: card.meaning, subject: card.subject }));
    return [...taskResults, ...deckResults, ...cardResults].slice(0, 12);
  })();
  const selectedShareDeck = shareableDecks.includes(shareDeck) ? shareDeck : (shareableDecks[0] ?? '');
  const deckWords = useMemo(() => vocab.filter(item => item.subject === deck), [vocab, deck]);
  const wrongDeckWords = useMemo(() => deckWords.filter(item => wrongIds.includes(item.id)), [deckWords, wrongIds]);
  const displayWords = useMemo(() => reviewWrongOnly ? deckWords.filter(item => wrongIds.includes(item.id)) : deckWords, [deckWords, reviewWrongOnly, wrongIds]);
  const quizQuestions = useMemo(() => {
    const source = quizRoundIds.length ? deckWords.filter(item => quizRoundIds.includes(item.id)) : quizReviewOnly ? wrongDeckWords : deckWords;
    return source.filter((item, index, items) => items.findIndex(candidate => candidate.meaning.trim().toLocaleLowerCase() === item.meaning.trim().toLocaleLowerCase()) === index).slice(0, 10);
  }, [deckWords, quizReviewOnly, quizRoundIds, wrongDeckWords]);
  const normalQuizQuestions = useMemo(() => deckWords.filter((item, index, items) => items.findIndex(candidate => candidate.meaning.trim().toLocaleLowerCase() === item.meaning.trim().toLocaleLowerCase()) === index).slice(0, 10), [deckWords]);
  const quizQuestion = quizQuestions[quizIndex];
  const quizOptions = useMemo(() => {
    if (!quizQuestion) return [];
    const distractors = [...deckWords, ...vocab].filter(item => item.id !== quizQuestion.id).filter((item, index, items) => items.findIndex(candidate => candidate.meaning.trim().toLocaleLowerCase() === item.meaning.trim().toLocaleLowerCase()) === index);
    const options = [quizQuestion, ...distractors.slice(0, 3)];
    const score = (id: string) => { let value = (quizShuffleSeed ^ 0x9e3779b9) >>> 0; for (const char of id) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0; return value; };
    return options.sort((left, right) => score(left.id) - score(right.id));
  }, [deckWords, vocab, quizQuestion, quizShuffleSeed]);
  const recentDays = useMemo(() => todayKey ? Array.from({ length: 7 }, (_, index) => shiftedDate(todayKey, index - 6)) : [], [todayKey]);
  const weekCompleted = recentDays.reduce((sum, key) => sum + (activity[key]?.completed ?? 0), 0); const progress = Math.min(100, Math.round((weekCompleted / weeklyGoal) * 100));
  const streak = useMemo(() => { if (!todayKey) return 0; let count = 0; for (let index = 0; index < 30; index += 1) { const day = activity[shiftedDate(todayKey, -index)]; if ((day?.completed ?? 0) + (day?.answered ?? 0) < 1) break; count += 1; } return count; }, [activity, todayKey]);
  const weekEnd = todayKey ? shiftedDate(todayKey, 6) : ''; const dueThisWeek = tasks.filter(task => !task.done && task.dueDate && todayKey && task.dueDate >= todayKey && task.dueDate <= weekEnd).length;
  const activeApiMonth = todayKey ? todayKey.slice(0, 7) : monthKey(new Date()); const apiLimit = premiumActive ? GEMINI_PREMIUM_LIMIT : GEMINI_FREE_LIMIT; const activeApiCount = apiUsage.month === activeApiMonth ? apiUsage.count : 0; const apiRemaining = Math.max(0, apiLimit - activeApiCount);
  const activeProvider: Provider = isPublicApp ? 'api' : provider;

  function recordApiUsage(amount: number) { const usage = { month: activeApiMonth, count: Math.min(apiLimit, activeApiCount + amount) }; setApiUsage(usage); localStorage.setItem('snaptask-api-usage', JSON.stringify(usage)); }

  async function startCheckout() {
    setBillingLoading(true); setBillingError('');
    try {
      const headers: HeadersInit = { 'content-type': 'application/json' }; if (authSession?.access_token) headers.Authorization = `Bearer ${authSession.access_token}`;
      const response = await fetch('/api/billing/checkout', { method: 'POST', headers, body: JSON.stringify({ plan: 'premium', email: authSession?.user.email ?? profileEmail }) });
      const data = await response.json() as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error ?? '決済設定が未完了です');
      window.location.href = data.url;
    } catch (error) { setBillingError(error instanceof Error ? error.message : '決済ページを開けませんでした'); setBillingLoading(false); }
  }

  function handleGoogleSignIn() {
    setAuthBusy(true); setAuthMessage('Googleのログイン画面へ移動します…');
    try { startGoogleSignIn(); } catch (error) { setAuthBusy(false); setAuthMessage(authErrorMessage(error)); }
  }

  async function handleSignOut() {
    if (!authSession) return; setAuthBusy(true); setAuthMessage('');
    try { await signOut(authSession); } catch { /* ローカルのセッションは必ず破棄する */ }
    localStorage.removeItem(AUTH_STORAGE_KEY); authSessionRef.current = null; setAuthSession(null); setAuthHydrated(false); setSyncMessage('ログアウトしました。この端末のデータは残っています。'); setAuthBusy(false);
  }

  async function requestCameraAccess(inputRef: { current: HTMLInputElement | null }) {
    setCameraMessage('カメラの使用許可を確認しています…');
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraMessage('このブラウザではカメラを直接起動できないため、写真ファイルを選んでください。');
      inputRef.current?.click();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } });
      stream.getTracks().forEach(track => track.stop());
      setCameraMessage('カメラの使用が許可されました。撮影画面を開きます。');
      inputRef.current?.click();
    } catch (error) {
      const denied = error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      setCameraMessage(denied ? 'カメラが許可されていません。ブラウザのサイト設定で「カメラ」を許可してから、もう一度押してください。' : 'カメラを起動できませんでした。写真ファイルを選ぶこともできます。');
    }
  }

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []); event.target.value = '';
    if (!files.length) return;
    if (files.some(file => file.size > MAX_UPLOAD_BYTES)) { setMessage('写真は1枚12MB以下にしてください。'); return; }
    if (activeProvider === 'api' && activeApiCount + files.length > apiLimit) { setMessage(`今月の写真解析枠（${apiLimit}枚）を超えるため停止しました。残り${apiRemaining}枚です。`); setBillingOpen(!premiumActive); return; }
    setFileName(files.length === 1 ? files[0].name : `${files.length}枚の写真`); setReading(true); setMessage(''); setDraftTasks([]);
    try {
      const images: Array<{ content: string; mimeType: string }> = []; const captured: SavedPhoto[] = [];
      for (const file of files) { const png = await toPng(file); const apiImage = await toApiImage(png); images.push({ content: await dataUrl(apiImage), mimeType: apiImage.type }); try { const thumb = await thumbnailDataUrl(png); if (thumb) { const id = newId('photo'); const storagePath = authSession ? `${authSession.user.id}/${id}.png` : ''; const savedPhoto: SavedPhoto = { id, name: file.name, dataUrl: thumb, createdAt: new Date().toISOString(), kind: 'task', ...(storagePath ? { storagePath } : {}) }; if (authSession && storagePath) { try { await uploadRemotePhoto(authSession, storagePath, png); } catch { delete savedPhoto.storagePath; } } captured.push(savedPhoto); } } catch { /* 写真保存に失敗しても解析は続行 */ } }
      assertApiImageSize(images); if (captured.length) savePhotos([...photos, ...captured]);
      const headers: HeadersInit = { 'content-type': 'application/json' }; if (authSession?.access_token) headers.Authorization = `Bearer ${authSession.access_token}`;
      const response = await fetch('/api/parse', { method: 'POST', headers, body: JSON.stringify({ provider: activeProvider, instruction: taskReadHint, images }) });
      const payload = await readApiResponse<{ tasks?: Array<{ title?: string; subject?: string; dueDate?: string; body?: string; estimatedMinutes?: number; duration?: number }>; error?: string }>(response); if (!response.ok) throw new Error(payload.error ?? '解析に失敗しました');
      if (activeProvider === 'api') recordApiUsage(files.length);
      const parsed = (payload.tasks ?? []).map(item => { const estimatedMinutes = safeMinutes(item.estimatedMinutes ?? item.duration); return { id: newId('task'), title: String(item.title ?? ''), subject: String(item.subject ?? ''), dueDate: String(item.dueDate ?? ''), body: String(item.body ?? ''), ...(estimatedMinutes ? { estimatedMinutes } : {}), done: false }; }).filter(item => item.title);
      if (!parsed.length) throw new Error('課題は見つかりませんでした。単語・公式の写真なら「暗記」ページで読み取ってね。'); setDraftTasks(parsed); setMessage(`${parsed.length}件の課題を読み取りました。内容を確認して保存してね。`);
    } catch (error) { setMessage(error instanceof Error ? error.message : '画像をPNGに変換できず、読み取れませんでした。JPEGまたはPNGで再試行してね。'); } finally { setReading(false); }
  }
  async function chooseMemoryPhoto(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []); event.target.value = '';
    if (!files.length) return;
    if (files.some(file => file.size > MAX_UPLOAD_BYTES)) { setMemoryMessage('写真は1枚12MB以下にしてください。'); return; }
    if (activeProvider === 'api' && activeApiCount + files.length > apiLimit) { setMemoryMessage(`今月の写真解析枠（${apiLimit}枚）を超えるため停止しました。残り${apiRemaining}枚です。`); setBillingOpen(!premiumActive); return; }
    setMemoryFileName(files.length === 1 ? files[0].name : `${files.length}枚の写真`); setMemoryReading(true); setMemoryMessage('');
    try {
      const images: Array<{ content: string; mimeType: string }> = []; const captured: SavedPhoto[] = [];
      for (const file of files) { const png = await toPng(file); const apiImage = await toApiImage(png); images.push({ content: await dataUrl(apiImage), mimeType: apiImage.type }); try { const thumb = await thumbnailDataUrl(png); if (thumb) { const id = newId('photo'); const storagePath = authSession ? `${authSession.user.id}/${id}.png` : ''; const savedPhoto: SavedPhoto = { id, name: file.name, dataUrl: thumb, createdAt: new Date().toISOString(), kind: 'memory', ...(storagePath ? { storagePath } : {}) }; if (authSession && storagePath) { try { await uploadRemotePhoto(authSession, storagePath, png); } catch { delete savedPhoto.storagePath; } } captured.push(savedPhoto); } } catch { /* 写真保存に失敗しても解析は続行 */ } }
      assertApiImageSize(images); if (captured.length) savePhotos([...photos, ...captured]);
      const headers: HeadersInit = { 'content-type': 'application/json' }; if (authSession?.access_token) headers.Authorization = `Bearer ${authSession.access_token}`;
      const response = await fetch('/api/parse', { method: 'POST', headers, body: JSON.stringify({ provider: activeProvider, mode: 'memorize', instruction: memoryReadHint, images }) });
      const payload = await readApiResponse<{ cards?: Array<{ front?: string; back?: string; subject?: string }>; error?: string }>(response); if (!response.ok) throw new Error(payload.error ?? '解析に失敗しました');
      if (activeProvider === 'api') recordApiUsage(files.length);
      const parsed = (payload.cards ?? []).map(item => ({ id: newId('vocab'), term: String(item.front ?? ''), meaning: String(item.back ?? ''), subject: String(item.subject ?? 'その他') })).filter(item => item.term && item.meaning);
      if (!parsed.length) throw new Error('暗記項目を見つけられませんでした'); const merged = mergeVocab(vocab, parsed); const added = merged.length - vocab.length; saveVocab(merged); setDeck(parsed[0].subject); setMemoryMessage(added ? `${added}件を${parsed[0].subject}の暗記ページに追加しました！` : '読み取ったカードはすべて登録済みでした。');
    } catch (error) { setMemoryMessage(error instanceof Error ? error.message : '画像をPNGに変換できず、読み取れませんでした。JPEGまたはPNGで再試行してね。'); } finally { setMemoryReading(false); }
  }
  function updateDraft(index: number, field: keyof Task, value: Task[keyof Task]) { setDraftTasks(current => current.map((item, i) => i === index ? { ...item, [field]: value } : item)); }
  function saveDraft() { const validTasks = draftTasks.filter(task => task.title.trim()); if (!validTasks.length) { setMessage('課題名を1件以上入力してください。'); return; } const merged = mergeTasks(tasks, validTasks); const added = merged.length - tasks.length; saveTasks(merged); setDraftTasks([]); setFileName(''); setMessage(added ? `${added}件の課題を保存しました！` : '読み取った課題はすべて登録済みでした。'); setScreen('home'); }
  function toggleTask(id: string) { const target = tasks.find(task => task.id === id); if (!target) return; saveTasks(tasks.map(task => task.id === id ? { ...task, done: !task.done } : task)); recordCompleted(target.done ? -1 : 1); }
  function removeTask(id: string) { const target = tasks.find(task => task.id === id); if (target && window.confirm(`「${target.title}」を削除しますか？`)) saveTasks(tasks.filter(task => task.id !== id)); }
  function removePhoto(id: string) {
    const target = photos.find(photo => photo.id === id);
    if (!target || !window.confirm(`「${target.name}」を写真一覧から削除しますか？`)) return;
    savePhotos(photos.filter(photo => photo.id !== id));
    if (selectedPhoto?.id === id) setSelectedPhoto(null);
    if (authSession && target.storagePath) void deleteRemotePhoto(authSession, target.storagePath).catch(() => { /* 一覧からは削除済み。次回の同期で再送しない */ });
  }
  function removeWord(id: string) { const target = vocab.find(card => card.id === id); if (target && window.confirm(`「${target.term}」を暗記カードから削除しますか？`)) { saveVocab(vocab.filter(card => card.id !== id)); setWrongIds(current => { const next = current.filter(cardId => cardId !== id); localStorage.setItem('snaptask-wrong-cards', JSON.stringify(next)); return next; }); } }
  function moveWord(id: string, subjectName: string) { const next = vocab.map(card => card.id === id ? { ...card, subject: subjectName } : card); saveVocab(next); if (shareDeck === vocab.find(card => card.id === id)?.subject) setShareDeck(subjectName); }
  function addDeck() { const value = window.prompt('教科・暗記ページの名前'); const name = value?.trim(); if (!name) return; if (decks.some(item => item.toLocaleLowerCase() === name.toLocaleLowerCase())) { setEnglishMessage('同じ名前の単語帳がすでにあります。'); setDeck(name); return; } saveDeckNames([...decks, name]); setDeck(name); setMemoryMode('list'); setReviewWrongOnly(false); setEnglishMessage(`「${name}」の単語帳を作りました。`); }
  function renameDeck(currentName: string) { const value = window.prompt('単語帳の名前を変更', currentName); const nextName = value?.trim(); if (!nextName || nextName === currentName) return; if (decks.some(item => item !== currentName && item.toLocaleLowerCase() === nextName.toLocaleLowerCase())) { setEnglishMessage('同じ名前の単語帳がすでにあります。'); return; } saveVocab(vocab.map(card => card.subject === currentName ? { ...card, subject: nextName } : card)); saveDeckNames(decks.map(item => item === currentName ? nextName : item)); setDeck(nextName); if (shareDeck === currentName) setShareDeck(nextName); setEnglishMessage(`単語帳を「${nextName}」に変更しました。`); }
  async function checkGemma() { setGemmaStatus('checking'); try { const response = await fetch('/api/parse?check=gemma'); setGemmaStatus(response.ok ? 'ready' : 'offline'); } catch { setGemmaStatus('offline'); } }
  function saveEditedTask() { if (!editingTask?.title.trim()) return; saveTasks(tasks.map(task => task.id === editingTask.id ? { ...editingTask, title: editingTask.title.trim(), subject: editingTask.subject.trim() || '教科未設定' } : task)); setEditingTask(null); }
  function changeGoal() { const value = window.prompt('1週間の完了目標（件）', String(weeklyGoal)); const parsed = Number(value); if (Number.isFinite(parsed) && parsed > 0 && parsed <= 99) { setWeeklyGoal(Math.round(parsed)); localStorage.setItem('snaptask-weekly-goal', String(Math.round(parsed))); } }
  function addWord(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!term.trim() || !meaning.trim()) { setEnglishMessage('用語と説明を入力してね。'); return; } const merged = mergeVocab(vocab, [{ id: newId('vocab'), term: term.trim(), meaning: meaning.trim(), subject: deck }]); if (merged.length === vocab.length) { setEnglishMessage('同じ用語はすでに登録されています。'); return; } saveVocab(merged); setTerm(''); setMeaning(''); setEnglishMessage('暗記カードに追加しました！'); }
  function dismissGuide() { setShowGuide(false); localStorage.setItem('snaptask-guide-seen', '1'); }
  function openTutorial() { setTutorialStep(0); setShowGuide(true); }
  function exportData() { const blob = new Blob([JSON.stringify({ tasks, vocab, deckNames, activity, weeklyGoal, wrongIds, photos, profile }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `snaptask-backup-${dateKey(new Date())}.json`; link.click(); URL.revokeObjectURL(url); setBackupMessage('バックアップを保存しました'); }
  function resetDemoData() { if (!window.confirm('課題・暗記カード・学習記録をデモ状態に戻します。保存済みデータは上書きされます。')) return; const nextTasks = demoTasksFor(todayKey || dateKey(new Date())); setTasks(nextTasks); setVocab([...starterVocab]); setDeckNames([...defaultDeckNames]); setActivity({}); setWrongIds([]); setWeeklyGoal(5); setSubject('すべて'); setDeck('英語'); setMemoryMode('list'); setReviewWrongOnly(false); setTutorialStep(0); setShowGuide(true); localStorage.setItem('snaptask-tasks', JSON.stringify(nextTasks)); localStorage.setItem('snaptask-vocab', JSON.stringify(starterVocab)); localStorage.setItem('snaptask-decks', JSON.stringify(defaultDeckNames)); localStorage.setItem('snaptask-activity', '{}'); localStorage.setItem('snaptask-wrong-cards', '[]'); localStorage.setItem('snaptask-weekly-goal', '5'); localStorage.removeItem('snaptask-guide-seen'); setBackupMessage('デモデータに戻しました'); }
  function importData(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const data = JSON.parse(String(reader.result)) as { tasks?: unknown; vocab?: unknown; deckNames?: unknown; activity?: unknown; weeklyGoal?: unknown; wrongIds?: unknown; photos?: unknown }; if (!Array.isArray(data.tasks) || !Array.isArray(data.vocab)) throw new Error('バックアップ形式が違います'); const nextTasks = normalizeTasks(data.tasks); const nextVocab = normalizeVocab(data.vocab); const nextActivity = normalizeActivity(data.activity); const nextWrongIds = normalizeWrongIds(data.wrongIds); const nextPhotos = normalizePhotos(data.photos); const storedDecks = Array.isArray(data.deckNames) ? data.deckNames.map(String).map(name => name.trim()).filter(Boolean) : []; const nextDecks = Array.from(new Set([...storedDecks, ...nextVocab.map(card => card.subject)])); setTasks(nextTasks); setVocab(nextVocab); setDeckNames(nextDecks.length ? nextDecks : defaultDeckNames); setWrongIds(nextWrongIds); setActivity(nextActivity); setPhotos(nextPhotos); if (typeof data.weeklyGoal === 'number' && data.weeklyGoal > 0) setWeeklyGoal(data.weeklyGoal); localStorage.setItem('snaptask-tasks', JSON.stringify(nextTasks)); localStorage.setItem('snaptask-vocab', JSON.stringify(nextVocab)); localStorage.setItem('snaptask-decks', JSON.stringify(nextDecks.length ? nextDecks : defaultDeckNames)); localStorage.setItem('snaptask-wrong-cards', JSON.stringify(nextWrongIds)); localStorage.setItem('snaptask-activity', JSON.stringify(nextActivity)); try { localStorage.setItem(PHOTOS_STORAGE_KEY, JSON.stringify(nextPhotos)); } catch { /* 写真は容量超過時に省略 */ } setBackupMessage('バックアップを復元しました'); } catch { setBackupMessage('バックアップを読み込めませんでした'); } }; reader.readAsText(file); }
  function deckPayload(name: string) { return JSON.stringify({ app: 'SnapTask', deck: name, cards: vocab.filter(card => card.subject === name).map(({ term, meaning, subject }) => ({ term, meaning, subject })) }, null, 2); }
  function deckShareUrl(name: string) { const url = new URL(window.location.href); url.hash = `share=${encodeShareData(deckPayload(name))}`; return url.toString(); }
  function deckReadableText(name: string) { const cards = vocab.filter(card => card.subject === name); return [`${name}｜SnapTask暗記ページ`, `${cards.length}枚のカード`, '', ...cards.map((card, index) => `${index + 1}. ${card.term}\n   ${card.meaning}`), '', 'SnapTaskで開く：', deckShareUrl(name)].join('\n'); }
  async function copyShareLink() { const name = selectedShareDeck; if (!name) { setShareMessage('共有できる暗記ページがありません。'); return; } try { await navigator.clipboard.writeText(deckShareUrl(name)); setShareMessage(`${name}の共有リンクをコピーしました。リンクを開くだけで取り込めます。`); } catch { setShareMessage('リンクをコピーできませんでした。もう一度試してね。'); } }
  async function openNativeShare() { const name = selectedShareDeck; if (!name) { setShareMessage('共有できる暗記ページがありません。'); return; } const url = deckShareUrl(name); if (typeof navigator.share === 'function') { try { await navigator.share({ title: `${name}｜SnapTask暗記ページ`, text: `${name}の暗記カード（${vocab.filter(card => card.subject === name).length}枚）を共有します。`, url }); setShareMessage(`${name}を共有しました。`); return; } catch (error) { if (error instanceof DOMException && error.name === 'AbortError') { setShareMessage('共有をキャンセルしました。'); return; } } } await copyShareLink(); }
  async function copyDeck() { const name = selectedShareDeck; if (!name) { setShareMessage('共有できる暗記ページがありません。'); return; } try { await navigator.clipboard.writeText(deckReadableText(name)); setShareMessage(`${name}の学習内容を読みやすい形式でコピーしました。`); } catch { setShareMessage('コピーできませんでした。共有リンクを使ってね。'); } }
  function downloadDeck() { const name = selectedShareDeck; if (!name) { setShareMessage('共有できる暗記ページがありません。'); return; } const blob = new Blob([deckPayload(name)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = `snaptask-${name}.json`; link.click(); URL.revokeObjectURL(url); setShareMessage(`${name}を共有ファイルにしました。`); }
  function importDeck(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; const reader = new FileReader(); reader.onload = () => { try { const data = recordOf(JSON.parse(String(reader.result))); const name = String(data.deck ?? '共有ページ').trim() || '共有ページ'; const rawCards = Array.isArray(data.cards) ? data.cards : []; const parsed = normalizeVocab(rawCards.map(card => ({ ...recordOf(card), subject: name }))).map(card => ({ ...card, id: newId('vocab'), subject: name })); if (!parsed.length) throw new Error('カードが見つかりません'); const merged = mergeVocab(vocab, parsed); const added = merged.length - vocab.length; saveVocab(merged); saveDeckNames([...decks, name]); setShareDeck(name); setShareMessage(added ? `${name}を${added}件取り込みました。` : `${name}はすでに取り込み済みです。`); } catch { setShareMessage('共有ファイルを読み込めませんでした。'); } }; reader.readAsText(file); }
  function loadSampleTasks() { setFileName('デモ用プリント'); setDraftTasks([{ id: newId('task'), title: '理科レポート「植物の蒸散」', subject: '理科', dueDate: shiftedDate(todayKey || dateKey(new Date()), 3), body: '教科書を参考に考察を書いて提出する', done: false }]); setMessage('デモ用の読み取り結果です。編集して保存できます。'); }
  function addManualTask(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!manualTitle.trim()) { setManualMessage('課題名を入力してください。'); return; } const estimatedMinutes = safeMinutes(manualMinutes); const task = { id: newId('task'), title: manualTitle.trim(), subject: manualSubject.trim() || '教科未設定', dueDate: manualDue, body: manualBody.trim(), ...(estimatedMinutes ? { estimatedMinutes } : {}), done: false }; const merged = mergeTasks(tasks, [task]); if (merged.length === tasks.length) { setManualMessage('同じ課題はすでに登録されています。'); return; } saveTasks(merged); setManualTitle(''); setManualSubject(''); setManualDue(''); setManualBody(''); setManualMinutes(''); setManualMessage(''); setMessage('課題を追加しました！'); setScreen('home'); }
  function startQuiz(reviewOnly = false) { const source = reviewOnly ? wrongDeckWords : deckWords; const unique = source.filter((item, index, items) => items.findIndex(candidate => candidate.meaning.trim().toLocaleLowerCase() === item.meaning.trim().toLocaleLowerCase()) === index).slice(0, 10); if (reviewOnly ? !unique.length : unique.length < 4) { setEnglishMessage(reviewOnly ? 'まちがいカードがありません。まず4択テストに挑戦してみよう。' : '4択テストには、説明が異なるカードが4件以上必要です。'); return; } setQuizReviewOnly(reviewOnly); setQuizShuffleSeed(Date.now()); setQuizRoundIds(unique.map(item => item.id)); setQuizIndex(0); setQuizScore(0); setQuizSelected(null); setQuizFinished(false); setMemoryMode('quiz'); }
  function startFlash() { if (!deckWords.length) { setEnglishMessage('一周学習にはカードが必要です。'); return; } setFlashIndex(0); setFlashKnown(0); setFlashRevealed(false); setFlashFinished(false); setMemoryMode('flash'); setReviewWrongOnly(false); }
  function answerFlash(known: boolean) { const card = deckWords[flashIndex]; if (!card || !flashRevealed) return; recordQuizAnswer(known); if (known) { setFlashKnown(value => value + 1); setWrongIds(current => { const next = current.filter(id => id !== card.id); localStorage.setItem('snaptask-wrong-cards', JSON.stringify(next)); return next; }); } else { setWrongIds(current => { const next = Array.from(new Set([...current, card.id])); localStorage.setItem('snaptask-wrong-cards', JSON.stringify(next)); return next; }); } if (flashIndex + 1 >= deckWords.length) setFlashFinished(true); else { setFlashIndex(index => index + 1); setFlashRevealed(false); } }
  function answerQuiz(value: string) { if (quizSelected || !quizQuestion) return; setQuizSelected(value); const correct = value === quizQuestion.meaning; recordQuizAnswer(correct); if (correct) { setQuizScore(score => score + 1); setWrongIds(current => { const next = current.filter(id => id !== quizQuestion.id); localStorage.setItem('snaptask-wrong-cards', JSON.stringify(next)); return next; }); } else { setWrongIds(current => { const next = Array.from(new Set([...current, quizQuestion.id])); localStorage.setItem('snaptask-wrong-cards', JSON.stringify(next)); return next; }); } window.setTimeout(() => { if (quizIndex + 1 >= quizQuestions.length) setQuizFinished(true); else { setQuizIndex(index => index + 1); setQuizSelected(null); } }, 650); }
  function openWorkspaceResult(result: WorkspaceResult) {
    setWorkspaceSearchOpen(false);
    setWorkspaceQuery('');
    if (result.kind === 'task') { setScreen('home'); setTaskQuery(result.title); return; }
    setDeck(result.kind === 'card' ? result.subject ?? '英語' : result.title);
    setMemoryMode('list');
    setReviewWrongOnly(false);
    setScreen('english');
  }

  // Serverとブラウザの初回HTMLを同じにして、保存データや日付によるHydration不一致を防ぐ。
  if (!mounted) return <main className="snap-shell app-loading" aria-busy="true" aria-live="polite"><span className="brand-dot">S</span><b>SnapTaskを準備中…</b></main>;

  return <main className={`snap-shell ${isPublicApp ? 'public-api-only' : ''}`}>
    <aside className="workspace-sidebar" aria-label="ワークスペース">
      <button className="sidebar-brand" onClick={() => setScreen('home')}><span className="brand-dot">S</span><span><b>SnapTask</b><small>マイワークスペース</small></span></button>
      <button className="sidebar-search" onClick={() => setWorkspaceSearchOpen(true)}><span>⌕</span><b>検索</b><kbd>⌘ K</kbd></button>
      <nav className="sidebar-nav" aria-label="メインメニュー">
        <button className={screen === 'home' ? 'active' : ''} onClick={() => setScreen('home')}><span>⌂</span>ホーム</button>
        <button className={screen === 'add' ? 'active' : ''} onClick={() => setScreen('add')}><span>＋</span>課題を追加</button>
        <button className={screen === 'english' ? 'active' : ''} onClick={() => setScreen('english')}><span>暗</span>暗記</button>
        <button className={screen === 'photos' ? 'active' : ''} onClick={() => setScreen('photos')}><span>▧</span>写真</button>
        <button className={screen === 'share' ? 'active' : ''} onClick={() => { setScreen('share'); setShareDeck(shareableDecks[0] ?? ''); setShareMessage(''); }}><span>↗</span>共有</button>
      </nav>
      <div className="sidebar-section"><div className="sidebar-section-heading"><b>暗記ページ</b><button onClick={addDeck} aria-label="暗記ページを追加">＋</button></div>{decks.slice(0, 8).map(item => <button type="button" key={item} className={`sidebar-deck ${screen === 'english' && deck === item ? 'active' : ''}`} onClick={() => { setDeck(item); setMemoryMode('list'); setReviewWrongOnly(false); setScreen('english'); }}><span className="sidebar-deck-icon">{item.slice(0, 1)}</span><span>{item}</span><small>{vocab.filter(word => word.subject === item).length}</small></button>)}</div>
      <button className="sidebar-account" onClick={() => setScreen('account')}><span className="sidebar-account-avatar">{profile?.displayName.slice(0, 1) || '＋'}</span><span><b>{profile?.displayName || 'Googleでログイン'}</b><small>{profile?.email || '学習データを同期'}</small></span><i>›</i></button>
    </aside>
    {workspaceSearchOpen && <div className="workspace-search-backdrop" role="presentation" onClick={() => setWorkspaceSearchOpen(false)}><div className="workspace-search" role="dialog" aria-modal="true" aria-label="ワークスペースを検索" onClick={event => event.stopPropagation()}><div className="workspace-search-input"><span>⌕</span><input autoFocus value={workspaceQuery} onChange={event => setWorkspaceQuery(event.target.value)} placeholder="課題・暗記ページ・カードを検索" aria-label="課題・暗記ページ・カードを検索" /><kbd>esc</kbd></div>{workspaceQuery.trim() ? workspaceResults.length ? <div className="workspace-search-results">{workspaceResults.map((result, index) => <button type="button" key={`${result.kind}-${result.title}-${index}`} onClick={() => openWorkspaceResult(result)}><span className={`search-result-icon search-result-${result.kind}`}>{result.kind === 'task' ? '✓' : result.kind === 'deck' ? '▤' : '暗'}</span><span><b>{result.title}</b><small>{result.subtitle}</small></span><i>{result.kind === 'task' ? '課題' : result.kind === 'deck' ? '暗記ページ' : result.subject}</i></button>)}</div> : <p className="workspace-search-empty">一致するページがありません</p> : <p className="workspace-search-hint">⌘K ですぐ検索。課題名、教科、単語、説明から探せます。</p>}</div></div>}
    <header className="snap-header"><button className="snap-brand" onClick={() => setScreen('home')}><span className="brand-dot">S</span><span><b>SnapTask</b><small>高校生のための提出物管理</small></span></button><div className="header-page-context">{screen === 'home' ? 'ホーム' : screen === 'add' ? '課題を追加' : screen === 'english' ? `暗記 / ${deck}` : screen === 'photos' ? '写真' : screen === 'share' ? '共有' : 'アカウント'}</div><button className="header-search" onClick={() => setWorkspaceSearchOpen(true)} aria-label="検索">⌕</button><button className="header-account" onClick={() => setScreen('account')} aria-label="アカウント登録"><span>{profile?.displayName.slice(0, 1) || '＋'}</span><small>{profile ? 'プロフィール' : 'Googleログイン'}</small></button><button className="header-add" onClick={() => setScreen('add')}>＋ 写真を追加</button></header>{isPublicApp && (screen === 'add' || screen === 'english') && <p className="provider-fixed-note">公開版はGemini APIで解析します</p>}
    {screen === 'home' && <section className="snap-page"><div className="snap-hero"><div><p className="kicker">TODAY</p><h1>やることを、<em>撮って終わらせる。</em></h1><p>プリントや黒板を撮るだけで、提出物が締切順にまとまります。</p></div><div className="today-count"><strong>{tasks.filter(task => !task.done).length}</strong><span>未完了</span></div></div>
      {showGuide && <section className="guide-card tutorial-card" aria-labelledby="tutorial-title"><div className="tutorial-head"><div><p className="kicker">TUTORIAL</p><h2 id="tutorial-title">SnapTaskの使い方</h2><p>写真から始めて、提出と復習まで4ステップ。</p></div><button aria-label="チュートリアルを閉じる" onClick={dismissGuide}>×</button></div><div className="tutorial-progress" aria-label="チュートリアルの進行"><span>{tutorialSteps.map((step, index) => <button type="button" key={step.label} className={index === tutorialStep ? 'active' : index < tutorialStep ? 'is-done' : ''} onClick={() => setTutorialStep(index)} aria-label={`${index + 1} ${step.label}`}><i>{index < tutorialStep ? '✓' : index + 1}</i>{step.label}</button>)}</span><small>{tutorialStep + 1} / {tutorialSteps.length}</small></div><div className="tutorial-body"><span className="tutorial-number">0{tutorialStep + 1}</span><div><b>{tutorialSteps[tutorialStep].label}</b><h3>{tutorialSteps[tutorialStep].title}</h3><p>{tutorialSteps[tutorialStep].body}</p></div></div><div className="tutorial-actions">{tutorialStep > 0 && <button className="outline-button" onClick={() => setTutorialStep(step => step - 1)}>← 戻る</button>}{tutorialStep < tutorialSteps.length - 1 ? <button className="save-button" onClick={() => setTutorialStep(step => step + 1)}>次へ →</button> : <button className="save-button" onClick={() => { dismissGuide(); setScreen('add'); }}>写真を追加する →</button>}</div></section>}
      <div className="quick-actions"><button className="capture-card" onClick={() => setScreen('add')}><span className="capture-icon">▣</span><span><b>プリント・黒板を撮る</b><small>課題名・教科・締切を自動入力</small></span><i>→</i></button><button className="capture-card memory-action" onClick={() => setScreen('english')}><span className="capture-icon">暗</span><span><b>教材を暗記カードにする</b><small>教科を判別して整理・復習</small></span><i>→</i></button></div>
      <section className="today-plan" aria-labelledby="today-plan-title"><div className="today-plan-heading"><div><p className="kicker">TODAY PLAN</p><h2 id="today-plan-title">今日やること</h2><p>締切と空き時間から、今やる課題を提案します。</p></div><label>空き時間<select value={focusMinutes} onChange={event => setFocusMinutes(Number(event.target.value))}><option value={15}>15分</option><option value={30}>30分</option><option value={45}>45分</option><option value={60}>60分</option></select></label></div>{recommendedTask ? <div className="today-recommendation"><span className="recommendation-icon">★</span><div><small>今のおすすめ</small><b>{focusMinutes}分なら「{recommendedTask.title}」を進めよう</b><span>{recommendedTask.estimatedMinutes ? `推定${recommendedTask.estimatedMinutes}分` : '所要時間未設定'} ・ {recommendedTask.dueDate ? (dueHint(recommendedTask.dueDate, todayKey) || formatDue(recommendedTask.dueDate)) : '締切未設定'}</span></div><button type="button" onClick={() => document.getElementById('task-list')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>課題を見る</button></div> : <div className="today-empty">今日やる課題はありません。おつかれさま！</div>}{todayTasks.length > 0 && <div className="today-task-list">{todayTasks.map(task => <div className="today-task-row" key={task.id}><span className={`today-task-dot due-${dueTone(task.dueDate, todayKey)}`} /><div><b>{task.title}</b><small>{task.dueDate ? (dueHint(task.dueDate, todayKey) || formatDue(task.dueDate)) : '締切未設定'}{task.estimatedMinutes ? ` ・ 約${task.estimatedMinutes}分` : ''}</small></div></div>)}</div>}</section><button className="photo-library-link" onClick={() => setScreen('photos')}><span>▧</span><span><b>撮った写真を見る</b><small>{photos.length ? `${photos.length}枚を保存中` : '読み取りに使った写真を見返す'}</small></span><i>→</i></button>
      <div className="snap-stats"><div><b>{tasks.length}</b><span>登録タスク</span></div><div><b>{tasks.filter(task => task.done).length}</b><span>完了</span></div><div><b>{dueThisWeek}</b><span>今週締切</span></div><div><b>{streak}</b><span>連続日数</span></div></div>
      <div className="progress-card"><div className="progress-heading"><div><p className="kicker">YOUR PACE</p><h2>今週のペース</h2></div><strong>{weekCompleted}<small> / {weeklyGoal}件</small></strong></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><div className="progress-foot"><span>{progress >= 100 ? '目標達成！' : `あと${Math.max(0, weeklyGoal - weekCompleted)}件で目標`}</span><span className="daily-log">今日のテスト {activity[todayKey]?.answered ?? 0}問・ミス {activity[todayKey]?.wrong ?? 0}問</span><button onClick={changeGoal}>目標を変更</button></div><div className="week-strip">{recentDays.map(key => <button type="button" key={key} className={`${(activity[key]?.completed ?? 0) + (activity[key]?.answered ?? 0) > 0 ? 'has-activity' : ''} ${selectedDay === key ? 'selected' : ''}`} onClick={() => setSelectedDay(key)} aria-label={`${formatDay(key)}：課題${activity[key]?.completed ?? 0}件、テスト${activity[key]?.answered ?? 0}問、ミス${activity[key]?.wrong ?? 0}問`}><span>{formatDay(key)}</span><i>{activity[key]?.completed ?? 0}</i><small>テスト {activity[key]?.answered ?? 0}</small></button>)}</div>{selectedDay && <div className="calendar-detail"><b>{selectedDay === todayKey ? '今日' : formatDay(selectedDay)}の振り返り</b><span>課題完了 <strong>{activity[selectedDay]?.completed ?? 0}</strong>件</span><span>テスト <strong>{activity[selectedDay]?.answered ?? 0}</strong>問</span><span>ミス <strong>{activity[selectedDay]?.wrong ?? 0}</strong>問</span></div>}</div>
      <div className="snap-section-title"><div><p className="kicker">TASKS</p><h2>提出物一覧</h2></div><button onClick={() => setShowDone(value => !value)}>{showDone ? '未完了だけ' : '完了も表示'}</button></div><label className="task-search"><span>⌕</span><input value={taskQuery} onChange={event => setTaskQuery(event.target.value)} placeholder="課題を検索" aria-label="課題を検索" />{taskQuery && <button type="button" onClick={() => setTaskQuery('')} aria-label="検索をクリア">×</button>}</label><div className="filter-row">{subjects.map(item => <button key={item} className={subject === item ? 'active' : ''} onClick={() => setSubject(item)}>{item}</button>)}</div>
      <div id="task-list" className="task-list">{sortedTasks.length ? sortedTasks.map(task => <article className={`task-card ${task.done ? 'is-done' : ''}`} key={task.id}>{editingTask?.id === task.id ? <div className="task-edit"><div className="task-edit-grid"><label>課題名<input value={editingTask.title} onChange={event => setEditingTask({ ...editingTask, title: event.target.value })} /></label><label>教科<input value={editingTask.subject} onChange={event => setEditingTask({ ...editingTask, subject: event.target.value })} /></label><label>締切<input type="date" value={editingTask.dueDate} onChange={event => setEditingTask({ ...editingTask, dueDate: event.target.value })} /></label><label>所要時間（分）<input type="number" min={1} max={600} value={editingTask.estimatedMinutes ?? ''} onChange={event => setEditingTask({ ...editingTask, estimatedMinutes: safeMinutes(event.target.value) || undefined })} /></label></div><label>やること<textarea rows={2} value={editingTask.body} onChange={event => setEditingTask({ ...editingTask, body: event.target.value })} /></label><div className="edit-actions"><button onClick={saveEditedTask}>保存</button><button onClick={() => setEditingTask(null)}>キャンセル</button></div></div> : <><button className="check-box" aria-label={`${task.title}を完了にする`} onClick={() => toggleTask(task.id)}>{task.done ? '✓' : ''}</button><div className="task-main"><div className="task-meta"><span>{task.subject || '教科未設定'}</span><time className={`due-${dueTone(task.dueDate, todayKey)}`}>{formatDue(task.dueDate)}{dueHint(task.dueDate, todayKey) && <small>{dueHint(task.dueDate, todayKey)}</small>}</time>{task.estimatedMinutes ? <small className="task-duration">約{task.estimatedMinutes}分</small> : null}</div><h3>{task.title}</h3><p>{task.body}</p></div><div className="task-actions"><button onClick={() => setEditingTask({ ...task })}>編集</button><button className="task-delete" aria-label={`${task.title}を削除`} onClick={() => removeTask(task.id)}>削除</button></div></>}</article>) : <div className="empty-state"><b>提出物はありません</b><span>写真を撮って課題を追加しよう。</span></div>}</div>
      <div className="data-tools"><span>{backupMessage || 'データはこの端末に保存されます'}</span><button onClick={openTutorial}>チュートリアル</button><button onClick={exportData}>バックアップ保存</button><label>復元<input type="file" accept="application/json,.json" onChange={importData} /></label><button className="reset-demo" onClick={resetDemoData}>デモに戻す</button></div>
    </section>}
    {screen === 'account' && <section className="snap-page account-page"><button className="back-link" onClick={() => setScreen('home')}>← ホームに戻る</button><p className="kicker">ACCOUNT</p><h1>アカウント</h1><p className="intro">Googleログインで、課題・暗記カード・学習記録を複数端末で同期できます。</p>{authSession ? <div className="account-card"><div className="account-card-heading"><span className="account-avatar-large">{profile?.displayName.slice(0, 1) || 'S'}</span><div><b>{profile?.displayName || 'SnapTaskユーザー'}</b><small>{authSession.user.email}</small></div></div><p className="sync-status">● {syncMessage || 'クラウド同期が有効です'}</p><button className="outline-button" onClick={handleSignOut} disabled={authBusy}>ログアウト</button></div> : supabaseReady ? <div className="account-card"><div className="account-card-heading"><span className="account-avatar-large">S</span><div><b>Googleでログイン</b><small>確認メールなしで学習データを同期</small></div></div><button className="google-button" type="button" onClick={handleGoogleSignIn} disabled={authBusy}>G&nbsp;&nbsp;Googleでログイン</button>{authMessage && <small className="account-message" role="status" aria-live="polite">{authMessage}</small>}</div> : <div className="account-card"><div className="account-card-heading"><span className="account-avatar-large">S</span><div><b>Googleログインの準備中</b><small>Supabaseの接続設定が必要です</small></div></div><p className="account-note">Googleログインを使うには、Vercelに <code>NEXT_PUBLIC_SUPABASE_URL</code> と <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> を設定して再デプロイしてください。</p></div>}</section>}
    {screen === 'photos' && <section className="snap-page photos-page"><button className="back-link" onClick={() => setScreen('home')}>← ホームに戻る</button><div className="photos-heading"><div><p className="kicker">PHOTO LIBRARY</p><h1>撮った写真</h1><p className="intro">読み取りに使った写真を、ログインした端末から見返せます。</p></div><span>{photos.length}枚</span></div>{photos.length ? <div className="photo-gallery">{[...photos].reverse().map(photo => <button type="button" className="saved-photo-card" key={photo.id} onClick={() => setSelectedPhoto(photo)}><Image src={photo.remoteUrl || `data:image/jpeg;base64,${photo.dataUrl}`} alt={photo.name} width={320} height={220} unoptimized /><span><b>{photo.name}</b><small>{photo.kind === 'memory' ? '暗記カード' : '課題'} ・ {photo.createdAt ? new Date(photo.createdAt).toLocaleDateString('ja-JP') : ''}{photo.storagePath ? ' ・ クラウド保存' : ''}</small></span></button>)}</div> : <div className="empty-state"><b>まだ写真がありません</b><span>「追加」や「暗記」から写真を読み取ると、ここに保存されます。</span><button className="save-button" onClick={() => setScreen('add')}>写真を追加する</button></div>}<small className="photo-storage-note">ログイン中は変換済みの写真原本をクラウドに保存し、未ログイン時はこの端末だけに保存します。</small></section>}
    {screen === 'add' && <section className="snap-page add-page"><button className="back-link" onClick={() => setScreen('home')}>← 一覧に戻る</button><p className="kicker">NEW TASK</p><h1>写真から課題を追加</h1><p className="intro">プリントや黒板を撮影すると、課題を自動で読み取ります。</p><div className="provider-switch"><span>解析方法</span><button className={provider === 'gemma' ? 'active' : ''} onClick={() => selectProvider('gemma')}>Gemma（Mac内）<small>APIなし</small></button><button className={provider === 'api' ? 'active' : ''} onClick={() => selectProvider('api')}>Gemini API<small>切り替え可能</small></button></div>{apiConfigStatus === 'missing' && <p className="api-setup-note">公開版の写真解析にはGemini APIの設定が必要です。Vercelの環境変数を確認してください。</p>}<p className="privacy-note">◎ Gemmaモードなら写真はこのMacの中で処理されます</p><label className="parse-hint"><span>読み取りの注意点（任意）</span><textarea value={taskReadHint} onChange={event => setTaskReadHint(event.target.value)} rows={2} maxLength={1000} placeholder="例：赤ペンで囲んだ部分だけ、課題名と締切を読み取って" /><small>読み取る範囲や優先したい部分を書いておくと、AIが参考にします。</small></label><label className="photo-drop"><input ref={taskPhotoInputRef} type="file" accept="image/*,.heic,.heif" multiple onChange={choosePhoto} /><span className="photo-icon">＋</span><b>{fileName || '写真を選ぶ（複数枚OK）'}</b><small>ファイルを開いて複数選択 / HEIC・JPGはPNGへ自動変換</small></label><input ref={taskCameraInputRef} className="camera-input" type="file" accept="image/*,.heic,.heif" capture="environment" onChange={choosePhoto} /><button type="button" className="camera-button" onClick={() => requestCameraAccess(taskCameraInputRef)}>▣ カメラで1枚撮る</button>{cameraMessage && <p className="camera-message" role="status">{cameraMessage}</p>}<button className="demo-button" onClick={loadSampleTasks}>写真がなくても試す（サンプル）</button><details className="manual-task"><summary>写真を使わず手入力で追加</summary><form onSubmit={addManualTask}><label>課題名<input value={manualTitle} onChange={event => setManualTitle(event.target.value)} placeholder="例：数学ワーク p.30" /></label><div className="draft-two draft-three"><label>教科<input value={manualSubject} onChange={event => setManualSubject(event.target.value)} placeholder="例：数学" /></label><label>締切<input type="date" value={manualDue} onChange={event => setManualDue(event.target.value)} /></label><label>所要時間（分）<input type="number" min={1} max={600} value={manualMinutes} onChange={event => setManualMinutes(event.target.value)} placeholder="例：30" /></label></div><label>やること<textarea rows={2} value={manualBody} onChange={event => setManualBody(event.target.value)} placeholder="提出内容やメモ" /></label><button className="save-button" type="submit">課題を追加する</button>{manualMessage && <small>{manualMessage}</small>}</form></details>{reading && <div className="loading-line" role="status" aria-live="polite"><span></span><b>{provider === 'gemma' ? 'Gemmaで解析中…' : 'APIで解析中…'}</b></div>}{message && <div role="status" aria-live="polite" className={`snap-message ${message.includes('Gemma') || message.includes('解析できません') ? 'message-error' : ''}`}><span>{message}</span>{message.includes('課題は見つかりません') && <button onClick={() => { setScreen('english'); setMemoryMessage('暗記ページで同じ写真を選んでください。'); }}>暗記ページで読み取る</button>}{message.includes('Gemma') && <button onClick={() => { selectProvider('api'); setMessage('Gemini APIに切り替えました。もう一度写真を選んでください。'); }}>Gemini APIへ切り替え</button>}</div>}{draftTasks.length > 0 && <div className="draft-panel"><div className="draft-heading"><div><p className="kicker">CHECK & EDIT</p><h2>読み取り結果</h2></div><span>{draftTasks.length}件</span></div>{draftTasks.map((task, index) => <div className="draft-row" key={task.id}><div className="draft-label">{index + 1}</div><div><label>課題名<input value={task.title} onChange={event => updateDraft(index, 'title', event.target.value)} /></label><div className="draft-two draft-three"><label>教科<input value={task.subject} onChange={event => updateDraft(index, 'subject', event.target.value)} /></label><label>締切<input type="date" value={task.dueDate} onChange={event => updateDraft(index, 'dueDate', event.target.value)} /></label><label>所要時間（分）<input type="number" min={1} max={600} value={task.estimatedMinutes ?? ''} onChange={event => updateDraft(index, 'estimatedMinutes', safeMinutes(event.target.value) || undefined)} placeholder="例：30" /></label></div><label>やること<textarea value={task.body} onChange={event => updateDraft(index, 'body', event.target.value)} rows={2} /></label></div></div>)}<button className="save-button" onClick={saveDraft}>この内容で保存する →</button></div>}</section>}
    {screen === 'english' && <section className="snap-page english-page"><p className="kicker">MEMORIZE</p><h1>教科ごとに暗記する</h1><p className="intro">教科書の表紙から選んで、カード一覧・一周学習・テストへ。</p><div className="provider-switch"><span>解析方法</span><button className={provider === 'gemma' ? 'active' : ''} onClick={() => selectProvider('gemma')}>Gemma（Mac内）<small>APIなし</small></button><button className={provider === 'api' ? 'active' : ''} onClick={() => selectProvider('api')}>Gemini API<small>切り替え可能</small></button></div><label className="parse-hint"><span>読み取りの注意点（任意）</span><textarea value={memoryReadHint} onChange={event => setMemoryReadHint(event.target.value)} rows={2} maxLength={1000} placeholder="例：オレンジペンで線を引いた語句と、その説明を読み取って" /><small>太字・色付き・囲みなど、優先したい範囲も指定できます。</small></label><label className="photo-drop memory-drop"><input ref={memoryPhotoInputRef} type="file" accept="image/*,.heic,.heif" multiple onChange={chooseMemoryPhoto} /><span className="photo-icon">＋</span><b>{memoryFileName || '写真・ファイルを選ぶ（複数枚OK）'}</b><small>ファイルを開いて複数選択 / HEIC・JPGはPNGへ自動変換 / 英語・数学・理科・社会などを自動判別</small></label><input ref={memoryCameraInputRef} className="camera-input" type="file" accept="image/*,.heic,.heif" capture="environment" onChange={chooseMemoryPhoto} /><button type="button" className="camera-button" onClick={() => requestCameraAccess(memoryCameraInputRef)}>▣ カメラで1枚撮る</button>{cameraMessage && <p className="camera-message" role="status">{cameraMessage}</p>}{memoryReading && <div className="loading-line" role="status" aria-live="polite"><span></span><b>{provider === 'gemma' ? 'Gemmaで教科を判別中…' : 'Geminiで教科を判別中…'}</b></div>}{memoryMessage && <div role="status" aria-live="polite" className={`snap-message ${memoryMessage.includes('Gemma') ? 'message-error' : ''}`}><span>{memoryMessage}</span>{memoryMessage.includes('Gemma') && <button onClick={() => { selectProvider('api'); setMemoryMessage('Gemini APIに切り替えました。もう一度写真を選んでください。'); }}>Gemini APIへ切り替え</button>}</div>}<div className="memory-tabs"><button className={memoryMode === 'list' && !reviewWrongOnly ? 'active' : ''} onClick={() => { setMemoryMode('list'); setReviewWrongOnly(false); }}>カード一覧</button><button className={memoryMode === 'quiz' && !quizReviewOnly ? 'active' : ''} onClick={() => startQuiz(false)} disabled={normalQuizQuestions.length < 4}>4択テスト</button><button className={memoryMode === 'list' && reviewWrongOnly ? 'active' : ''} onClick={() => { setMemoryMode('list'); setReviewWrongOnly(true); }} disabled={!wrongDeckWords.length}>まちがい {wrongDeckWords.length ? `(${wrongDeckWords.length})` : ''}</button></div>{wrongDeckWords.length > 0 && <div className="review-actions"><button className="outline-button" onClick={() => startQuiz(true)}>まちがいだけを4択で復習（{wrongDeckWords.length}件）</button></div>}{memoryMode === 'quiz' ? <div className="quiz-panel">{quizFinished ? <div className="quiz-result"><p className="kicker">{quizReviewOnly ? 'WRONG ANSWERS REVIEW' : 'ROUND COMPLETE'}</p><strong>{quizScore}/{quizQuestions.length}</strong><p>{Math.round((quizScore / quizQuestions.length) * 100)}%正解。{quizReviewOnly ? '間違えたカードだけの復習が終わりました。' : 'おつかれさま！まちがえたカードは「まちがい」に残っています。'}</p><button onClick={() => startQuiz(quizReviewOnly)}>もう一度挑戦</button></div> : quizQuestion ? <><div className="quiz-progress"><span>第{quizIndex + 1}問 / {quizQuestions.length}問</span><span>正解 {quizScore}</span></div><div className="quiz-term-row"><h2>{quizQuestion.term}</h2><SpeechButton text={quizQuestion.term} /></div><p>正しい説明を選んでください</p><div className="quiz-options">{quizOptions.map(option => <button key={option.id} className={`quiz-option ${quizSelected ? option.meaning === quizQuestion.meaning ? 'correct' : option.meaning === quizSelected ? 'wrong' : '' : ''}`} onClick={() => answerQuiz(option.meaning)}>{option.meaning}</button>)}</div></> : <div className="empty-state"><b>カードがありません</b><span>先に暗記カードを追加しよう。</span></div>}</div> : <><div className="english-deck-grid">{decks.map(item => <button type="button" key={item} className={`deck-card ${deck === item ? 'active' : ''}`} onClick={() => { setDeck(item); setMemoryMode('list'); setReviewWrongOnly(false); }} aria-label={`${item}の暗記ページを開く`}><Image src={deckArtPath(item)} alt="" width={640} height={360} sizes="(max-width: 560px) 50vw, 320px" /><span className="deck-card-copy"><b>{item}</b><small>{vocab.filter(word => word.subject === item).length}項目</small></span><i>›</i></button>)}</div><div className="deck-utilities"><button className="new-deck" onClick={addDeck}>＋ 教科を追加</button><button className="rename-deck" onClick={() => renameDeck(deck)} disabled={!deck}>✎ {deck || '選択中'}の名前を変更</button></div><div className="selected-deck-heading"><div><p className="kicker">SELECTED DECK</p><h2>{deck}</h2></div><span>{displayWords.length}項目</span></div><div className="word-list">{displayWords.map(word => <article key={word.id}><span className="word-mark">暗</span><div><div className="word-term-row"><b>{word.term}</b><SpeechButton text={word.term} /></div><p>{word.meaning}</p></div><button className="word-delete" aria-label={`${word.term}を削除`} onClick={() => removeWord(word.id)}>削除</button></article>)}</div>{reviewWrongOnly && !displayWords.length && <div className="empty-state"><b>まちがいカードはありません</b><span>この調子！テストで間違えたカードがここに残ります。</span></div>}<form className="word-form" onSubmit={addWord}><h2>{deck}の暗記カードを手入力</h2><input value={term} onChange={event => setTerm(event.target.value)} placeholder="覚える用語・公式・単語" /><input value={meaning} onChange={event => setMeaning(event.target.value)} placeholder="答え・説明" /><button className="save-button" type="submit">暗記ページに追加 ＋</button>{englishMessage && <small>{englishMessage}</small>}</form></>}</section>}
    {screen === 'share' && <section className="snap-page share-page"><button className="back-link" onClick={() => setScreen('home')}>← ホームに戻る</button><p className="kicker">SHARE</p><h1>暗記ページを共有</h1><p className="intro">単語帳を選んで、リンクを送るだけ。受け取った人はSnapTaskでそのまま取り込めます。</p>{shareableDecks.length ? <><div className="share-decks">{shareableDecks.map(item => <button key={item} className={selectedShareDeck === item ? 'active' : ''} onClick={() => { setShareDeck(item); setShareMessage(''); }}><Image src={deckArtPath(item)} alt="" width={96} height={96} /><div><b>{item}</b><small>{vocab.filter(card => card.subject === item).length}項目</small></div><i>›</i></button>)}</div><div className="share-actions"><button className="save-button" onClick={openNativeShare}>友だちに共有する</button><button className="outline-button" onClick={copyShareLink}>リンクをコピー</button><button className="outline-button" onClick={copyDeck}>学習内容をコピー</button></div><button className="share-file-button" onClick={downloadDeck}>バックアップ用JSONを保存</button>{shareMessage && <p className="share-message" role="status" aria-live="polite">{shareMessage}</p>}<div className="share-import"><b>友だちから受け取った単語帳</b><span>共有リンクを開くか、バックアップ用JSONを取り込むとカードが追加されます。</span><label className="import-button">JSONファイルを取り込む<input type="file" accept="application/json,.json" onChange={importDeck} /></label></div></> : <div className="empty-state"><b>共有できる暗記ページがありません</b><span>まず「暗記」からカードを追加しよう。</span></div>}</section>}
    <nav className="snap-nav"><button className={screen === 'home' ? 'active' : ''} onClick={() => setScreen('home')}><span>⌂</span>ホーム</button><button className={screen === 'add' ? 'active' : ''} onClick={() => setScreen('add')}><span>＋</span>追加</button><button className={screen === 'english' ? 'active' : ''} onClick={() => setScreen('english')}><span>暗</span>暗記</button><button className={screen === 'photos' ? 'active' : ''} onClick={() => setScreen('photos')}><span>▧</span>写真</button><button className={screen === 'share' ? 'active' : ''} onClick={() => { setScreen('share'); setShareDeck(shareableDecks[0] ?? ''); setShareMessage(''); }}><span>↗</span>共有</button></nav>
    {screen === 'english' && memoryMode !== 'flash' && <button className="flash-launch" onClick={startFlash} disabled={!deckWords.length}>一周学習をはじめる</button>}
    {screen === 'english' && memoryMode === 'flash' && <FlashStudyPanel cards={deckWords} index={flashIndex} known={flashKnown} revealed={flashRevealed} finished={flashFinished} onReveal={() => setFlashRevealed(true)} onAnswer={answerFlash} onRestart={startFlash} onClose={() => { setMemoryMode('list'); setFlashFinished(false); }} />}
    {provider === 'api' && <button className="api-quota-badge" onClick={() => setBillingOpen(true)}>Gemini API：今月あと{apiRemaining}枚 <small>{premiumActive ? 'プレミアム' : '枚数を増やす'}</small></button>}
    {provider === 'gemma' && (screen === 'add' || screen === 'english') && <div className={`gemma-status gemma-${gemmaStatus}`}><span>{gemmaStatus === 'ready' ? '● Gemma接続中' : gemmaStatus === 'offline' ? '● Gemma未接続' : gemmaStatus === 'checking' ? '○ 接続確認中…' : '○ Gemma接続を確認'}</span><button onClick={checkGemma} disabled={gemmaStatus === 'checking'}>{gemmaStatus === 'offline' ? '再確認' : '確認'}</button>{gemmaStatus === 'offline' && <button className="gemma-switch" onClick={() => selectProvider('api')}>Geminiへ</button>}</div>}
    {screen === 'english' && !manageOpen && memoryMode !== 'flash' && <button className="organize-launch" onClick={() => setManageOpen(true)} disabled={!deckWords.length}>カードを整理</button>}
    {screen === 'english' && manageOpen && <MoveCardPanel cards={deckWords} decks={decks} onMove={moveWord} onClose={() => setManageOpen(false)} />}
    {selectedPhoto && <div className="photo-viewer-backdrop" role="presentation" onClick={() => setSelectedPhoto(null)}><div className="photo-viewer" role="dialog" aria-modal="true" aria-label="写真を表示" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setSelectedPhoto(null)} aria-label="閉じる">×</button><Image src={selectedPhoto.remoteUrl || `data:image/jpeg;base64,${selectedPhoto.dataUrl}`} alt={selectedPhoto.name} width={1000} height={760} unoptimized /><b>{selectedPhoto.name}</b><small>{selectedPhoto.kind === 'memory' ? '暗記カード' : '課題'}として読み取り{selectedPhoto.storagePath ? ' ・ クラウド保存' : ''}</small><button className="photo-delete-button" onClick={() => removePhoto(selectedPhoto.id)}>この写真を削除</button></div></div>}
    {billingOpen && <div className="modal-backdrop" role="presentation" onClick={() => setBillingOpen(false)}><div className="billing-modal" role="dialog" aria-modal="true" aria-labelledby="billing-title" onClick={event => event.stopPropagation()}><button className="modal-close" onClick={() => setBillingOpen(false)} aria-label="閉じる">×</button><span className="premium-kicker">PREMIUM</span><h2 id="billing-title">写真の読み取り枚数を増やす</h2><p>無料枠は月20枚。プレミアムなら月300枚までGeminiで読み取れます。</p><div className="plan-price"><strong>¥480</strong><span>/ 月（予定）</span></div><ul><li>写真からの課題・暗記カード作成 月300枚</li><li>HEIC・JPGの自動PNG変換</li><li>手入力・学習記録は今まで通り無料</li></ul><p className="billing-promo-hint">クーポンコードを持っている場合は、次のStripe決済画面で入力できます。</p><button className="save-button" onClick={startCheckout} disabled={billingLoading}>{billingLoading ? '決済ページを準備中…' : '購入ページへ進む →'}</button>{billingError && <small className="billing-error">{billingError}<br />Stripeの決済情報をVercelに設定すると有効になります。</small>}<small className="billing-note">決済設定が未完了の間は、課金は発生しません。</small></div></div>}
  </main>;
}
