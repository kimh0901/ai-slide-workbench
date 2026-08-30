import JSZip from 'jszip';
import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';
import type { ParsedSource, TemplateTheme } from './types';

const allowed = new Set(['pdf', 'docx', 'xlsx', 'xls', 'csv', 'txt', 'md', 'pptx']);
const MAX_FILE_SIZE = 25 * 1024 * 1024;

function extensionOf(name: string) {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

function cleanText(value: string) {
  return value.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
}

async function parsePdf(buffer: ArrayBuffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.min.mjs', import.meta.url).toString();
  const document = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  const pages: string[] = [];
  for (let index = 1; index <= Math.min(document.numPages, 120); index += 1) {
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    pages.push(`[PDF 第 ${index} 頁]\n${text}`);
  }
  return { text: pages.join('\n\n'), units: document.numPages, unitLabel: '頁' };
}

async function parseDocx(buffer: ArrayBuffer) {
  const result = await mammoth.extractRawText({ arrayBuffer: buffer });
  return { text: result.value, units: Math.max(1, result.value.split(/\n{2,}/).length), unitLabel: '段' };
}

function parseWorkbook(buffer: ArrayBuffer) {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheets = workbook.SheetNames.map((name) => {
    const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name], { blankrows: false });
    return `[工作表：${name}]\n${csv}`;
  });
  return { text: sheets.join('\n\n'), units: workbook.SheetNames.length, unitLabel: '工作表' };
}

function parseThemeXml(themeXml: string, name: string, slideCount: number): TemplateTheme {
  const colorMatches = [...themeXml.matchAll(/<a:srgbClr[^>]*val="([0-9A-Fa-f]{6})"/g)].map((match) => match[1].toUpperCase());
  const fontFace = themeXml.match(/<a:latin[^>]*typeface="([^"]+)"/)?.[1];
  return { name, colors: [...new Set(colorMatches)].slice(0, 8), fontFace, slideCount };
}

async function parsePptx(buffer: ArrayBuffer, name: string) {
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => Number(a.match(/\d+/)?.[0]) - Number(b.match(/\d+/)?.[0]));
  const slides: string[] = [];
  for (const path of slideFiles.slice(0, 80)) {
    const xml = await zip.file(path)?.async('text');
    if (!xml) continue;
    const page = Number(path.match(/\d+/)?.[0] ?? 0);
    const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((match) => match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
    if (texts.length) slides.push(`[投影片 ${page}]\n${texts.join('\n')}`);
  }
  const themeXml = await zip.file('ppt/theme/theme1.xml')?.async('text') ?? '';
  return {
    text: slides.join('\n\n'),
    units: slideFiles.length,
    unitLabel: '張',
    theme: parseThemeXml(themeXml, name, slideFiles.length),
  };
}

export async function parseFile(file: File): Promise<ParsedSource> {
  const extension = extensionOf(file.name);
  if (!allowed.has(extension)) throw new Error(`不支援 .${extension || '未知'} 檔案，請改用 PDF、DOCX、XLSX、PPTX、CSV、TXT 或 Markdown。`);
  if (file.size > MAX_FILE_SIZE) throw new Error(`${file.name} 超過 MVP 的 25 MB 上限。`);
  if (/m$/.test(extension)) throw new Error('MVP 不接受含巨集的 Office 檔案。');

  const buffer = await file.arrayBuffer();
  let result: { text: string; units: number; unitLabel: string; theme?: TemplateTheme };
  if (extension === 'pdf') result = await parsePdf(buffer);
  else if (extension === 'docx') result = await parseDocx(buffer);
  else if (extension === 'xlsx' || extension === 'xls') result = parseWorkbook(buffer);
  else if (extension === 'pptx') result = await parsePptx(buffer, file.name);
  else result = { text: await file.text(), units: 1, unitLabel: '份' };

  const text = cleanText(result.text);
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: file.name,
    extension,
    text,
    characters: text.length,
    units: result.units,
    unitLabel: result.unitLabel,
    isTemplate: extension === 'pptx' && text.length < 160,
    theme: result.theme,
  };
}
