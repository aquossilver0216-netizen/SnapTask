'use client';

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';

type Task = { id: string; title: string; subject: string; dueDate: string; body: string; done: boolean };
type Vocab = { id: string; term: string; meaning: string; subject: string };
type Activity = Record<string, { completed: number }>;
type Screen = 'home' | 'add' | 'english';
type Provider = 'gemma' | 'api';

const starterTasks: Task[] = [
  { id: 'task-1', title: '数学ワーク p.24〜27', subject: '数学', dueDate: '2026-08-30', body: '問題を解いて提出する', done: false },
  { id: 'task-2', title: '英語 長文プリント', subject: '英語', dueDate: '2026-09-02', body: '本文を読み、設問に答える', done: false },
];
const starterVocab: Vocab[] = [
  { id: 'v-1', term: 'available', meaning: '利用できる、手に入る', subject: '英語' },
  { id: 'v-2', term: 'take part in ～', meaning: '～に参加する', subject: '英語' },
  { id: 'v-3', term: 'in advance', meaning: '前もって、あらかじめ', subject: '英語' },
];
const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

function newId(prefix: string) { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
function shiftedDate(key: string, offset: number) { const date = new Date(`${key}T12:00:00`); date.setDate(date.getDate() + offset); return dateKey(date); }
function formatDue(value: string) { if (!value) return '締切未設定'; const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : `${date.getMonth() + 1}/${date.getDate()}(${weekdays[date.getDay()]})`; }
function formatDay(key: string) { const date = new Date(`${key}T12:00:00`); return `${date.getMonth() + 1}/${date.getDate()}`; }

async function toPng(file: File): Promise<File> {
  let source: Blob = file;
  if (/\.(heic|heif)$/i.test(file.name) || /image\/(heic|heif)/i.test(file.type)) {
    const heic2any = (await import('heic2any')).default;
    const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: .94 });
    source = Array.isArray(converted) ? converted[0] : converted;
  }
  const image = await createImageBitmap(source);
  const scale = Math.min(1, 2200 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画像を変換できません');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height); image.close();
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('PNG変換に失敗しました')), 'image/png'));
  return new File([blob], file.name.replace(/\.(heic|heif|jpe?g)$/i, '.png'), { type: 'image/png' });
}
function dataUrl(file: File) { return new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1] ?? ''); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); }

export default function Home() {
  const [screen, setScreen] = useState<Screen>('home');
  const [tasks, setTasks] = useState<Task[]>(starterTasks); const [vocab, setVocab] = useState<Vocab[]>(starterVocab); const [activity, setActivity] = useState<Activity>({});
  const [todayKey, setTodayKey] = useState(''); const [weeklyGoal, setWeeklyGoal] = useState(5); const [provider, setProvider] = useState<Provider>('gemma');
  const [reading, setReading] = useState(false); const [message, setMessage] = useState(''); const [fileName, setFileName] = useState('');
  const [memoryReading, setMemoryReading] = useState(false); const [memoryMessage, setMemoryMessage] = useState(''); const [memoryFileName, setMemoryFileName] = useState('');
  const [draftTasks, setDraftTasks] = useState<Task[]>([]); const [subject, setSubject] = useState('すべて'); const [showDone, setShowDone] = useState(false);
  const [deck, setDeck] = useState('英語'); const [term, setTerm] = useState(''); const [meaning, setMeaning] = useState(''); const [englishMessage, setEnglishMessage] = useState(''); const [editingTask, setEditingTask] = useState<Task | null>(null);

  function saveTasks(next: Task[]) { setTasks(next); localStorage.setItem('snaptask-tasks', JSON.stringify(next)); }
  function saveVocab(next: Vocab[]) { setVocab(next); localStorage.setItem('snaptask-vocab', JSON.stringify(next)); }
  function recordCompleted(delta: number) { const key = todayKey || dateKey(new Date()); setActivity(current => { const next = { ...current, [key]: { completed: Math.max(0, (current[key]?.completed ?? 0) + delta) } }; localStorage.setItem('snaptask-activity', JSON.stringify(next)); return next; }); }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTodayKey(dateKey(new Date()));
      try {
        const savedTasks = JSON.parse(localStorage.getItem('snaptask-tasks') ?? 'null'); if (Array.isArray(savedTasks)) setTasks(savedTasks);
        const savedWords = JSON.parse(localStorage.getItem('snaptask-vocab') ?? 'null'); if (Array.isArray(savedWords)) setVocab(savedWords.map(item => ({ id: String(item.id ?? newId('vocab')), term: String(item.term ?? ''), meaning: String(item.meaning ?? ''), subject: String(item.subject ?? item.deck ?? '英語') })));
        const savedActivity = JSON.parse(localStorage.getItem('snaptask-activity') ?? 'null'); if (savedActivity && typeof savedActivity === 'object') setActivity(savedActivity);
        const savedGoal = Number(localStorage.getItem('snaptask-weekly-goal')); if (Number.isFinite(savedGoal) && savedGoal > 0) setWeeklyGoal(savedGoal);
      } catch { /* use starter data */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const sortedTasks = useMemo(() => tasks.filter(task => (showDone || !task.done) && (subject === 'すべて' || task.subject === subject)).sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999')), [tasks, showDone, subject]);
  const subjects = useMemo(() => ['すべて', ...Array.from(new Set(tasks.map(task => task.subject).filter(Boolean)))], [tasks]);
  const decks = useMemo(() => Array.from(new Set(vocab.map(item => item.subject))), [vocab]);
  const deckWords = useMemo(() => vocab.filter(item => item.subject === deck), [vocab, deck]);
  const recentDays = useMemo(() => todayKey ? Array.from({ length: 7 }, (_, index) => shiftedDate(todayKey, index - 6)) : [], [todayKey]);
  const weekCompleted = recentDays.reduce((sum, key) => sum + (activity[key]?.completed ?? 0), 0); const progress = Math.min(100, Math.round((weekCompleted / weeklyGoal) * 100));
  const streak = useMemo(() => { if (!todayKey) return 0; let count = 0; for (let index = 0; index < 30; index += 1) { if ((activity[shiftedDate(todayKey, -index)]?.completed ?? 0) < 1) break; count += 1; } return count; }, [activity, todayKey]);
  const weekEnd = todayKey ? shiftedDate(todayKey, 6) : ''; const dueThisWeek = tasks.filter(task => !task.done && task.dueDate && todayKey && task.dueDate >= todayKey && task.dueDate <= weekEnd).length;

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []); event.target.value = ''; if (!files.length) return; setFileName(files.length === 1 ? files[0].name : `${files.length}枚の写真`); setReading(true); setMessage(''); setDraftTasks([]);
    try { const images = []; for (const file of files) { const png = await toPng(file); images.push({ content: await dataUrl(png) }); } const response = await fetch('/api/parse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider, images }) }); const payload = await response.json() as { tasks?: Array<{ title?: string; subject?: string; dueDate?: string; body?: string }>; error?: string }; if (!response.ok) throw new Error(payload.error ?? '解析に失敗しました'); const parsed = (payload.tasks ?? []).map(item => ({ id: newId('task'), title: String(item.title ?? ''), subject: String(item.subject ?? ''), dueDate: String(item.dueDate ?? ''), body: String(item.body ?? ''), done: false })).filter(item => item.title); if (!parsed.length) throw new Error('課題を見つけられませんでした'); setDraftTasks(parsed); setMessage(`${parsed.length}件の課題を読み取りました。内容を確認して保存してね。`); } catch (error) { setMessage(error instanceof Error ? error.message : '読み取れませんでした'); } finally { setReading(false); }
  }
  async function chooseMemoryPhoto(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []); event.target.value = ''; if (!files.length) return; setMemoryFileName(files.length === 1 ? files[0].name : `${files.length}枚の写真`); setMemoryReading(true); setMemoryMessage('');
    try { const images = []; for (const file of files) { const png = await toPng(file); images.push({ content: await dataUrl(png) }); } const response = await fetch('/api/parse', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ provider, mode: 'memorize', images }) }); const payload = await response.json() as { cards?: Array<{ front?: string; back?: string; subject?: string }>; error?: string }; if (!response.ok) throw new Error(payload.error ?? '解析に失敗しました'); const parsed = (payload.cards ?? []).map(item => ({ id: newId('vocab'), term: String(item.front ?? ''), meaning: String(item.back ?? ''), subject: String(item.subject ?? 'その他') })).filter(item => item.term && item.meaning); if (!parsed.length) throw new Error('暗記項目を見つけられませんでした'); saveVocab([...vocab, ...parsed]); setDeck(parsed[0].subject); setMemoryMessage(`${parsed.length}件を${parsed[0].subject}の暗記ページに追加しました！`); } catch (error) { setMemoryMessage(error instanceof Error ? error.message : '読み取れませんでした'); } finally { setMemoryReading(false); }
  }
  function updateDraft(index: number, field: keyof Task, value: string) { setDraftTasks(current => current.map((item, i) => i === index ? { ...item, [field]: value } : item)); }
  function saveDraft() { if (!draftTasks.length) return; saveTasks([...tasks, ...draftTasks]); setDraftTasks([]); setFileName(''); setMessage('課題を保存しました！'); setScreen('home'); }
  function toggleTask(id: string) { const target = tasks.find(task => task.id === id); if (!target) return; saveTasks(tasks.map(task => task.id === id ? { ...task, done: !task.done } : task)); recordCompleted(target.done ? -1 : 1); }
  function removeTask(id: string) { const target = tasks.find(task => task.id === id); if (target && window.confirm(`「${target.title}」を削除しますか？`)) saveTasks(tasks.filter(task => task.id !== id)); }
  function saveEditedTask() { if (!editingTask?.title.trim()) return; saveTasks(tasks.map(task => task.id === editingTask.id ? { ...editingTask, title: editingTask.title.trim(), subject: editingTask.subject.trim() || '教科未設定' } : task)); setEditingTask(null); }
  function changeGoal() { const value = window.prompt('1週間の完了目標（件）', String(weeklyGoal)); const parsed = Number(value); if (Number.isFinite(parsed) && parsed > 0 && parsed <= 99) { setWeeklyGoal(Math.round(parsed)); localStorage.setItem('snaptask-weekly-goal', String(Math.round(parsed))); } }
  function addWord(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!term.trim() || !meaning.trim()) { setEnglishMessage('用語と説明を入力してね。'); return; } saveVocab([...vocab, { id: newId('vocab'), term: term.trim(), meaning: meaning.trim(), subject: deck }]); setTerm(''); setMeaning(''); setEnglishMessage('暗記カードに追加しました！'); }

  return <main className="snap-shell">
    <header className="snap-header"><button className="snap-brand" onClick={() => setScreen('home')}><span className="brand-dot">S</span><span><b>SnapTask</b><small>高校生のための提出物管理</small></span></button><button className="header-add" onClick={() => setScreen('add')}>＋ 写真を追加</button></header>
    {screen === 'home' && <section className="snap-page"><div className="snap-hero"><div><p className="kicker">TODAY</p><h1>やることを、<em>撮って終わらせる。</em></h1><p>プリントや黒板を撮るだけで、提出物が締切順にまとまります。</p></div><div className="today-count"><strong>{tasks.filter(task => !task.done).length}</strong><span>未完了</span></div></div>
      <div className="quick-actions"><button className="capture-card" onClick={() => setScreen('add')}><span className="capture-icon">▣</span><span><b>プリント・黒板を撮る</b><small>課題名・教科・締切を自動入力</small></span><i>→</i></button><button className="capture-card memory-action" onClick={() => setScreen('english')}><span className="capture-icon">暗</span><span><b>教材を暗記カードにする</b><small>教科を判別して整理・復習</small></span><i>→</i></button></div>
      <div className="snap-stats"><div><b>{tasks.length}</b><span>登録タスク</span></div><div><b>{tasks.filter(task => task.done).length}</b><span>完了</span></div><div><b>{dueThisWeek}</b><span>今週締切</span></div><div><b>{streak}</b><span>連続日数</span></div></div>
      <div className="progress-card"><div className="progress-heading"><div><p className="kicker">YOUR PACE</p><h2>今週のペース</h2></div><strong>{weekCompleted}<small> / {weeklyGoal}件</small></strong></div><div className="progress-track"><span style={{ width: `${progress}%` }} /></div><div className="progress-foot"><span>{progress >= 100 ? '目標達成！' : `あと${Math.max(0, weeklyGoal - weekCompleted)}件で目標`}</span><button onClick={changeGoal}>目標を変更</button></div><div className="week-strip">{recentDays.map(key => <div key={key} className={(activity[key]?.completed ?? 0) > 0 ? 'has-activity' : ''}><span>{formatDay(key)}</span><i>{activity[key]?.completed ?? 0}</i></div>)}</div></div>
      <div className="snap-section-title"><div><p className="kicker">TASKS</p><h2>提出物一覧</h2></div><button onClick={() => setShowDone(value => !value)}>{showDone ? '未完了だけ' : '完了も表示'}</button></div><div className="filter-row">{subjects.map(item => <button key={item} className={subject === item ? 'active' : ''} onClick={() => setSubject(item)}>{item}</button>)}</div>
      <div className="task-list">{sortedTasks.length ? sortedTasks.map(task => <article className={`task-card ${task.done ? 'is-done' : ''}`} key={task.id}>{editingTask?.id === task.id ? <div className="task-edit"><div className="task-edit-grid"><label>課題名<input value={editingTask.title} onChange={event => setEditingTask({ ...editingTask, title: event.target.value })} /></label><label>教科<input value={editingTask.subject} onChange={event => setEditingTask({ ...editingTask, subject: event.target.value })} /></label><label>締切<input type="date" value={editingTask.dueDate} onChange={event => setEditingTask({ ...editingTask, dueDate: event.target.value })} /></label></div><label>やること<textarea rows={2} value={editingTask.body} onChange={event => setEditingTask({ ...editingTask, body: event.target.value })} /></label><div className="edit-actions"><button onClick={saveEditedTask}>保存</button><button onClick={() => setEditingTask(null)}>キャンセル</button></div></div> : <><button className="check-box" aria-label={`${task.title}を完了にする`} onClick={() => toggleTask(task.id)}>{task.done ? '✓' : ''}</button><div className="task-main"><div className="task-meta"><span>{task.subject || '教科未設定'}</span><time>{formatDue(task.dueDate)}</time></div><h3>{task.title}</h3><p>{task.body}</p></div><div className="task-actions"><button onClick={() => setEditingTask({ ...task })}>編集</button><button className="task-delete" aria-label={`${task.title}を削除`} onClick={() => removeTask(task.id)}>削除</button></div></>}</article>) : <div className="empty-state"><b>提出物はありません</b><span>写真を撮って課題を追加しよう。</span></div>}</div>
    </section>}
    {screen === 'add' && <section className="snap-page add-page"><button className="back-link" onClick={() => setScreen('home')}>← 一覧に戻る</button><p className="kicker">NEW TASK</p><h1>写真から課題を追加</h1><p className="intro">プリントや黒板を撮影すると、課題を自動で読み取ります。</p><div className="provider-switch"><span>解析方法</span><button className={provider === 'gemma' ? 'active' : ''} onClick={() => setProvider('gemma')}>Gemma（Mac内）<small>APIなし</small></button><button className={provider === 'api' ? 'active' : ''} onClick={() => setProvider('api')}>Gemini API<small>切り替え可能</small></button></div><p className="privacy-note">◎ Gemmaモードなら写真はこのMacの中で処理されます</p><label className="photo-drop"><input type="file" accept="image/*,.heic,.heif" multiple capture="environment" onChange={choosePhoto} /><span className="photo-icon">＋</span><b>{fileName || '写真を撮る・選ぶ'}</b><small>HEIC・JPGはPNGへ自動変換 / 複数枚OK</small></label>{reading && <div className="loading-line"><span></span><b>{provider === 'gemma' ? 'Gemmaで解析中…' : 'APIで解析中…'}</b></div>}{message && <p className="snap-message">{message}</p>}{draftTasks.length > 0 && <div className="draft-panel"><div className="draft-heading"><div><p className="kicker">CHECK & EDIT</p><h2>読み取り結果</h2></div><span>{draftTasks.length}件</span></div>{draftTasks.map((task, index) => <div className="draft-row" key={task.id}><div className="draft-label">{index + 1}</div><div><label>課題名<input value={task.title} onChange={event => updateDraft(index, 'title', event.target.value)} /></label><div className="draft-two"><label>教科<input value={task.subject} onChange={event => updateDraft(index, 'subject', event.target.value)} /></label><label>締切<input type="date" value={task.dueDate} onChange={event => updateDraft(index, 'dueDate', event.target.value)} /></label></div><label>やること<textarea value={task.body} onChange={event => updateDraft(index, 'body', event.target.value)} rows={2} /></label></div></div>)}<button className="save-button" onClick={saveDraft}>この内容で保存する →</button></div>}</section>}
    {screen === 'english' && <section className="snap-page english-page"><p className="kicker">MEMORIZE</p><h1>教科ごとに暗記する</h1><p className="intro">写真を撮るとAIが教科を判別して、暗記ページに整理します。</p><div className="provider-switch"><span>解析方法</span><button className={provider === 'gemma' ? 'active' : ''} onClick={() => setProvider('gemma')}>Gemma（Mac内）<small>APIなし</small></button><button className={provider === 'api' ? 'active' : ''} onClick={() => setProvider('api')}>Gemini API<small>切り替え可能</small></button></div><label className="photo-drop memory-drop"><input type="file" accept="image/*,.heic,.heif" multiple capture="environment" onChange={chooseMemoryPhoto} /><span className="photo-icon">＋</span><b>{memoryFileName || '暗記したい教材を撮る'}</b><small>英語・数学・理科・社会などを自動判別</small></label>{memoryReading && <div className="loading-line"><span></span><b>{provider === 'gemma' ? 'Gemmaで教科を判別中…' : 'APIで教科を判別中…'}</b></div>}{memoryMessage && <p className="snap-message">{memoryMessage}</p>}<div className="english-decks">{decks.map(item => <button key={item} className={deck === item ? 'active' : ''} onClick={() => setDeck(item)}><span>▥</span><b>{item}</b><small>{vocab.filter(word => word.subject === item).length}項目</small></button>)}<button className="new-deck" onClick={() => { const name = window.prompt('教科・暗記ページの名前'); if (name?.trim()) setDeck(name.trim()); }}>＋ 教科を追加</button></div><div className="word-list">{deckWords.map(word => <article key={word.id}><span className="word-mark">暗</span><div><b>{word.term}</b><p>{word.meaning}</p></div></article>)}</div><form className="word-form" onSubmit={addWord}><h2>{deck}の暗記カードを手入力</h2><input value={term} onChange={event => setTerm(event.target.value)} placeholder="覚える用語・公式・単語" /><input value={meaning} onChange={event => setMeaning(event.target.value)} placeholder="答え・説明" /><button className="save-button" type="submit">暗記ページに追加 ＋</button>{englishMessage && <small>{englishMessage}</small>}</form></section>}
    <nav className="snap-nav"><button className={screen === 'home' ? 'active' : ''} onClick={() => setScreen('home')}><span>⌂</span>ホーム</button><button className={screen === 'add' ? 'active' : ''} onClick={() => setScreen('add')}><span>＋</span>追加</button><button className={screen === 'english' ? 'active' : ''} onClick={() => setScreen('english')}><span>暗</span>暗記</button></nav>
  </main>;
}
