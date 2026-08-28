import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return { name: 'SnapTask｜高校生の提出物管理', short_name: 'SnapTask', description: 'プリントや黒板を撮るだけで、課題と暗記を整理するアプリ。', start_url: '/', display: 'standalone', background_color: '#f8f7f2', theme_color: '#17755f', lang: 'ja', icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }] };
}
