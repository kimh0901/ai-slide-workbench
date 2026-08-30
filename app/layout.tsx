import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI 簡報任務包工作台｜從資料到可查證大綱',
  description: '把工作資料整理成可查證大綱，並輸出 Gamma、NotebookLM、ChatGPT／Claude 指令、Markdown 任務包與 PowerPoint 文字骨架。',
  openGraph: {
    title: 'AI 簡報任務包工作台',
    description: '內容先治理，視覺交給最適合的工具。',
    type: 'website',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'AI 簡報工作台五步驟流程' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AI 簡報任務包工作台',
    description: '內容先治理，視覺交給最適合的工具。',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant">
      <body>{children}</body>
    </html>
  );
}
