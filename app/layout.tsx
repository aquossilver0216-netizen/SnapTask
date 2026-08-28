import type { Metadata, Viewport } from 'next';
import './globals.css';
import './flash.css';
import './tutorial.css';

export const metadata: Metadata = { title: 'SnapTask｜高校生の提出物管理', description: 'プリントや黒板を撮るだけで、提出物を締切順に整理する高校生向けアプリ。', icons: { icon: '/icon.svg', apple: '/icon.svg' } };
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#17755f' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ja"><body>{children}</body></html>;
}
