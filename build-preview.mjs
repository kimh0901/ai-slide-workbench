import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/claude/lab2';
const WORK = path.join(ROOT, '.preview-build');
fs.mkdirSync(WORK, { recursive: true });

/* 預覽版沒有伺服器路由，改在瀏覽器端直接跑本機規則引擎 */
fs.writeFileSync(path.join(WORK, 'entry.tsx'), `import { createRoot } from 'react-dom/client';
import Home from '${ROOT}/app/page.tsx';
import { buildLocalDeck } from '${ROOT}/lib/deck';

const realFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : async () => { throw new Error('此瀏覽器不支援 fetch'); };
window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (url.includes('/api/generate')) {
    const body = JSON.parse(String(init?.body ?? '{}'));
    const deck = buildLocalDeck(
      body.requirements,
      body.sourceText ?? '',
      body.sourceNames ?? [],
      '這是離線預覽檔，沒有伺服器金鑰，因此使用本機規則引擎（非 AI）。在上一步填入自己的模型金鑰即可取得 AI 大綱。',
    );
    // 回傳最小可用的 Response 形狀，不依賴環境是否提供 Response 建構子
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => (name.toLowerCase() === 'content-type' ? 'application/json' : null) },
      json: async () => deck,
      text: async () => JSON.stringify(deck),
    };
  }
  return realFetch(input, init);
};

const container = document.getElementById('root');
if (container) createRoot(container).render(<Home />);
`);

const result = await esbuild.build({
  entryPoints: [path.join(WORK, 'entry.tsx')],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  minify: true,
  write: false,
  absWorkingDir: ROOT,
  define: { 'process.env.NODE_ENV': '"production"' },
  external: ['node:*', 'fs', 'path', 'stream', 'https', 'http', 'zlib', 'crypto', 'url', 'util', 'canvas'],
});

let js = result.outputFiles[0].text;

/* pdf.js 的 worker 路徑在單檔打包中無法解析（import.meta 在 iife 為空），改指向 CDN */
const PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
const workerPattern = /new URL\("pdfjs-dist\/legacy\/build\/pdf\.worker\.min\.mjs",[^)]*\)\.toString\(\)/;
if (!workerPattern.test(js)) throw new Error('找不到 pdf worker 的寫法，請確認 lib/parser.ts 是否改動。');
js = js.replace(workerPattern, JSON.stringify(PDF_WORKER));

const cssFile = fs.readdirSync(path.join(ROOT, 'dist/client/_next/static/css'))[0];
const css = fs.readFileSync(path.join(ROOT, 'dist/client/_next/static/css', cssFile), 'utf8');

const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AI 簡報任務包工作台（離線預覽）</title>
<style>
${css}
</style>
</head>
<body>
<div id="root"></div>
<script>
${js}
</script>
</body>
</html>
`;

const out = '/mnt/user-data/outputs/AI簡報任務包工作台_預覽.html';
fs.writeFileSync(out, html);
console.log(`wrote ${out} (${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} MB)`);
console.log(`  css ${(css.length / 1024).toFixed(0)} KB / js ${(js.length / 1024).toFixed(0)} KB`);
