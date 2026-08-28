'use client';

import { useEffect } from 'react';

export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('SnapTask route error'); }, []);
  return <main className="error-shell"><div className="error-card"><span className="brand-dot">S</span><p className="kicker">SNAPTASK</p><h1>画面を読み込めませんでした</h1><p>一時的なエラーかもしれません。保存済みの課題データはそのまま残っています。</p><button onClick={() => reset()}>もう一度読み込む</button></div></main>;
}
