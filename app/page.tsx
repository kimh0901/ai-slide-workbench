'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { STYLE_PRESETS } from '../lib/styles';
import { MODEL_OPTIONS, PROVIDER_INFO, ModelError, generateDeck, providerOf } from '../lib/providers';
import { buildLocalDeck } from '../lib/deck';
import type { DeckSlide, DeckSpec, FlowMode, ParsedSource, Requirements } from '../lib/types';

const steps = ['匯入素材', '設定任務', '證據大綱', '選擇輸出', '取得任務包'];
const scenarios = ['定期數據月報', '臨時交辦比較', '專案成果報告', '主管決策提案', '教育訓練教材'];
const structures = ['結論先行', '問題－解法', 'SCQA', '比較矩陣', '黃金圈', 'PREP'];
const modelOptions = [
  { value: 'local', label: '本機規則引擎', hint: '不需金鑰｜只重組原文，不做語意歸納' },
  ...MODEL_OPTIONS.map((item) => ({ value: item.value, label: item.label, hint: item.hint })),
];
const KEY_STORAGE = 'ai-slide-workbench-key';

const defaultRequirements: Requirements = {
  topic: '', scenario: scenarios[0], audience: '主管與業務同仁', objective: '', slideCount: 5, duration: 10,
  tone: '專業、清楚、以數據說話', structure: structures[0], notes: true, classification: '內部',
};

const practiceData = `全台住宅用電與節能宣導月報\n資料期間：2026 年 7 月；單位：萬度、%、場、人次\n全台住宅用電量 113,760 萬度，較去年同期增加 1.86%。\n全台辦理 156 場節能宣導活動，參與 12,848 人次。\n新竹縣用電增加 4.20%，宣導 4 場；桃園市增加 3.80%，宣導 12 場；金門縣增加 3.10%，宣導 3 場。\n宜蘭縣、花蓮縣、臺東縣與南投縣用電呈負成長。\n任務：找出高成長區與宣導資源落差，提出下一階段可執行的資源配置建議。`;

function formatNumber(value: number) {
  return new Intl.NumberFormat('zh-TW').format(value);
}

function move<T>(items: T[], from: number, to: number) {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function slideOutline(deck: DeckSpec) {
  return deck.slides.map((slide, index) => [
    `## ${index + 1}. ${slide.title}`,
    `> ${slide.conclusion}`,
    ...slide.bullets.map((bullet) => `- ${bullet}`),
    `- 來源：${slide.source || '待補資料'}`,
  ].join('\n')).join('\n\n');
}

function makeOutputs(deck: DeckSpec, requirements: Requirements, sourceNames: string[], styleName: string) {
  const commonRules = `受眾：${requirements.audience}\n目的：${requirements.objective}\n頁數：${deck.slides.length} 頁\n語氣：${requirements.tone}\n規則：每頁一個核心結論；標題 15 字內；最多 4 個重點；數字保留單位與來源；無依據內容標示「待補資料」。`;
  const outline = slideOutline(deck);
  return {
    gamma: `請在 Gamma 建立一份 16:9 簡報。\n\n${commonRules}\n視覺方向：${styleName}；清楚、正式、避免裝飾性圖像干擾數據。請保留每頁來源於頁尾，文字與圖表需可編輯。\n\n【已核對大綱】\n${outline}`,
    notebook: `你是來源查證助理。請只依據已上傳至 NotebookLM 的資料回答，不可補充來源外資訊。\n\n任務主題：${requirements.topic}\n來源清單：${sourceNames.join('、') || '使用者提供資料'}\n\n請依序完成：\n1. 找出支援每頁核心結論的原文、頁碼或表格位置。\n2. 列出缺乏證據或可能誤讀的敘述。\n3. 核對所有數字、單位、期間及比較基準。\n4. 以「頁次｜主張｜來源位置｜核對結果」輸出查證表。\n\n【待查證大綱】\n${outline}`,
    llm: `你是企業簡報內容編輯，請嚴格依據提供的來源與既定大綱優化文字，不可變更數字或新增推論。\n\n${commonRules}\n\n請檢查故事線、刪除重複內容、將模糊形容詞改成有來源的數據，並以相同 Markdown 結構輸出。\n\n【已核對大綱】\n${outline}`,
    full: `# ${deck.title}\n\n## 簡報任務卡\n- 工作情境：${requirements.scenario}\n- 目標受眾：${requirements.audience}\n- 希望促成的決定：${requirements.objective}\n- 資料分級：${requirements.classification}\n- 來源：${sourceNames.join('、') || '使用者輸入文字'}\n- 輸出風格：${styleName}\n\n## 品質規則\n${commonRules}\n\n## 逐頁證據大綱\n${outline}\n\n## 待補與風險\n${deck.warnings.length ? deck.warnings.map((item) => `- ${item}`).join('\n') : '- 無；仍須由簡報負責人進行最終核對。'}`,
  };
}

export default function Home() {
  const [step, setStep] = useState(0);
  const [unlocked, setUnlocked] = useState(0);
  const [flowMode, setFlowMode] = useState<FlowMode>('source');
  const [model, setModel] = useState('gemini-2.5-flash');
  const [apiKey, setApiKey] = useState('');
  const [keyVisible, setKeyVisible] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [manualText, setManualText] = useState('');
  const [sources, setSources] = useState<ParsedSource[]>([]);
  const [requirements, setRequirements] = useState(defaultRequirements);
  const [deck, setDeck] = useState<DeckSpec | null>(null);
  const [styleId, setStyleId] = useState('energy');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedStyle = STYLE_PRESETS.find((item) => item.id === styleId) ?? STYLE_PRESETS[0];
  const templateTheme = sources.find((item) => item.theme)?.theme;
  const sourceText = useMemo(() => sources.map((item) => `[來源：${item.name}]\n${item.text}`).join('\n\n'), [sources]);
  const sourceCharacters = sources.reduce((sum, item) => sum + item.characters, 0);
  const outputs = useMemo(() => deck ? makeOutputs(deck, requirements, sources.map((item) => item.name), selectedStyle.name) : null, [deck, requirements, sources, selectedStyle.name]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('ai-slide-workbench-draft');
      if (!stored) return;
      const draft = JSON.parse(stored) as { requirements?: Requirements; model?: string; styleId?: string; deck?: DeckSpec };
      if (draft.requirements) setRequirements(draft.requirements);
      if (draft.model) setModel(draft.model);
      if (draft.styleId) setStyleId(draft.styleId);
      if (draft.deck) { setDeck(draft.deck); setUnlocked(4); }
    } catch { /* ignore an invalid device-local draft */ }
    // 金鑰另存一個項目，且永遠不會寫進可分享的草稿內容
    try { setApiKey(localStorage.getItem(KEY_STORAGE) ?? ''); } catch { /* 無痕模式可忽略 */ }
  }, []);

  useEffect(() => {
    try {
      if (apiKey.trim()) localStorage.setItem(KEY_STORAGE, apiKey.trim());
      else localStorage.removeItem(KEY_STORAGE);
    } catch { /* 無痕模式可忽略 */ }
  }, [apiKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem('ai-slide-workbench-draft', JSON.stringify({ requirements, model, styleId, deck }));
      } catch { /* 配額不足或無痕模式：略過保存，不可讓例外中斷畫面 */ }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [requirements, model, styleId, deck]);

  function go(next: number) {
    if (next <= unlocked) { setError(''); setStep(next); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  }

  function addFiles(incoming: FileList | File[]) {
    const accepted = Array.from(incoming).filter((file) => !files.some((current) => current.name === file.name && current.size === file.size));
    setFiles((current) => [...current, ...accepted].slice(0, 10));
    setError('');
  }

  async function handleParse() {
    if (!files.length && !manualText.trim()) { setError('請上傳至少一份來源，或直接輸入文字。'); return; }
    if (flowMode === 'template' && !files.some((file) => file.name.toLowerCase().endsWith('.pptx'))) { setError('套用範本模式需要一份 .pptx 空白簡報或單位範本。'); return; }
    setBusy('正在本機解析來源…'); setError('');
    try {
      const { parseFile } = await import('../lib/parser');
      const parsed: ParsedSource[] = [];
      for (const file of files) parsed.push(await parseFile(file));
      if (manualText.trim()) parsed.push({ id: crypto.randomUUID(), name: '直接輸入文字', extension: 'txt', text: manualText.trim(), characters: manualText.trim().length, units: 1, unitLabel: '份' });
      const usefulText = parsed.filter((item) => !item.isTemplate).reduce((sum, item) => sum + item.characters, 0);
      if (usefulText < 30) throw new Error('範本已讀取，但仍需要至少一段簡報內容或資料來源。');
      setSources(parsed); setUnlocked((value) => Math.max(value, 1)); setStep(1);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '檔案解析失敗。'); }
    finally { setBusy(''); }
  }

  async function handleGenerate() {
    if (!requirements.topic.trim() || !requirements.objective.trim()) { setError('請填寫簡報主題與希望促成的決定。'); return; }
    if (requirements.classification === '機密' && model !== 'local') { setError('機密資料不可送往外部模型；請改選「本機規則引擎」或將資料去識別化。'); return; }
    if (!sourceText.trim()) { setError('沒有可用的來源內容，請回上一步重新解析素材。'); return; }

    const trimmedKey = apiKey.trim();
    setError('');

    // 使用者自備金鑰：由瀏覽器直接呼叫模型，金鑰不會經過本站伺服器
    if (model !== 'local' && trimmedKey) {
      setBusy(`${modelOptions.find((item) => item.value === model)?.label ?? model} 正在依 Rules 建立逐頁大綱…`);
      try {
        const result = await generateDeck({ model, apiKey: trimmedKey, sourceText, sourceNames: sources.map((item) => item.name), requirements });
        setDeck(result); setUnlocked((value) => Math.max(value, 2)); setStep(2);
        return;
      } catch (reason) {
        const message = reason instanceof ModelError ? reason.message : reason instanceof Error ? reason.message : '大綱生成失敗。';
        // 明確告知失敗原因，而不是安靜地退回規則引擎讓使用者以為這就是 AI 產出
        setError(`${message} 已改用本機規則引擎產生草稿，修正金鑰或額度後可重新生成。`);
        setDeck(buildLocalDeck(requirements, sourceText, sources.map((item) => item.name), `AI 生成失敗（${message}），本頁內容由本機規則引擎重組原文而來，未經語意歸納。`));
        setUnlocked((value) => Math.max(value, 2)); setStep(2);
        return;
      } finally { setBusy(''); }
    }

    // 沒有自備金鑰：交給伺服器路由（可能設有組織金鑰，否則回傳本機規則引擎結果）
    setBusy(model === 'local' ? '正在以本機規則引擎整理大綱…' : '正在嘗試伺服器金鑰…');
    try {
      const response = await fetch('/api/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, sourceText, sourceNames: sources.map((item) => item.name), requirements }) });
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) throw new Error('生成服務暫時無法連線，請重新整理頁面後再試。');
      const result = await response.json() as DeckSpec & { error?: string };
      if (!response.ok || result.error) throw new Error(result.error || '大綱生成失敗。');
      setDeck(result); setUnlocked((value) => Math.max(value, 2)); setStep(2);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '大綱生成失敗。'); }
    finally { setBusy(''); }
  }

  function updateSlide(index: number, patch: Partial<DeckSlide>) {
    setDeck((current) => current ? { ...current, slides: current.slides.map((slide, slideIndex) => slideIndex === index ? { ...slide, ...patch } : slide) } : current);
  }

  function confirmOutline() {
    if (!deck?.slides.length) return;
    setUnlocked((value) => Math.max(value, 3)); setStep(3); setError('');
  }

  function confirmStyle() {
    setUnlocked((value) => Math.max(value, 4)); setStep(4); setError('');
  }

  async function handleExport() {
    if (!deck) return;
    setBusy('正在排版並產生可編輯 PowerPoint…'); setError('');
    try {
      const { exportDeck } = await import('../lib/pptx');
      await exportDeck(deck, selectedStyle, flowMode === 'template' ? templateTheme : undefined);
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'PowerPoint 匯出失敗。'); }
    finally { setBusy(''); }
  }

  async function copyOutput(name: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(name);
    window.setTimeout(() => setCopied(''), 1800);
  }

  function downloadTaskPack() {
    if (!outputs || !deck) return;
    const blob = new Blob([outputs.full], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${deck.title.replace(/[\\/:*?"<>|]/g, '').slice(0, 60) || '簡報'}_任務包.md`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function clearDraft() {
    localStorage.removeItem('ai-slide-workbench-draft');
    setStep(0); setUnlocked(0); setFiles([]); setSources([]); setManualText(''); setRequirements(defaultRequirements); setDeck(null); setStyleId('energy'); setError('');
  }

  return (
    <main className="min-h-screen bg-[#f3f6f4] text-[#12241f]">
      <header className="sticky top-0 z-30 border-b border-[#dce5e1] bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-4 px-4 py-3.5 sm:px-6 lg:px-9">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-[#126149] text-sm font-black text-white">AI</div>
            <div><p className="text-xs font-bold tracking-[.12em] text-[#568072]">9/17 AI 培力課程｜課後工作平台</p><h1 className="text-xl font-black tracking-tight">AI 簡報任務包工作台</h1></div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden items-center gap-2 text-sm font-semibold text-[#50615b] sm:flex"><span className="h-2 w-2 rounded-full bg-[#2da174]" />原始檔案於本機解析</span>
            <button type="button" onClick={clearDraft} className="rounded-lg border border-[#d6dfdb] px-3 py-2 text-sm font-bold text-[#60706a] hover:bg-[#f3f6f4]">清除本機草稿</button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-[1480px] px-4 py-6 sm:px-6 lg:px-9">
        <div className="mb-5 flex flex-col justify-between gap-3 xl:flex-row xl:items-end">
          <div><p className="text-base font-bold text-[#147456]">內容先治理，視覺交給最適合的工具</p><h2 className="mt-1 text-3xl font-black leading-tight tracking-[-.035em] sm:text-[42px]">把工作資料變成可查證、可交付的簡報任務包。</h2></div>
          <p className="max-w-xl text-base leading-7 text-[#62716c]">依課程 Rules 先確認受眾、證據與故事線，再一次取得 Gamma、NotebookLM、ChatGPT／Claude 專用指令，以及可編輯的 PowerPoint 文字骨架。</p>
        </div>

        <nav className="mb-5 grid grid-cols-5 overflow-hidden rounded-2xl border border-[#d8e2de] bg-white shadow-sm" aria-label="簡報生成進度">
          {steps.map((label, index) => (
            <button key={label} type="button" onClick={() => go(index)} disabled={index > unlocked} className={`flex min-w-0 items-center justify-center gap-2 border-r border-[#e3e9e6] px-1 py-3.5 text-center text-sm font-bold last:border-r-0 sm:px-3 sm:text-base ${step === index ? 'bg-[#126149] text-white' : index <= unlocked ? 'text-[#276b56] hover:bg-[#eef7f3]' : 'cursor-not-allowed text-[#9ca7a3]'}`}>
              <span className={`hidden h-7 w-7 place-items-center rounded-full text-sm sm:grid ${step === index ? 'bg-white/20' : 'bg-[#eef2f0]'}`}>{index + 1}</span>{label}
            </button>
          ))}
        </nav>

        {error && <div role="alert" className="mb-4 flex items-start justify-between gap-4 rounded-xl border border-[#e7b4aa] bg-[#fff4f1] px-4 py-3 text-sm font-semibold text-[#8a3526]"><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="關閉錯誤訊息">×</button></div>}
        {busy && <div className="mb-4 flex items-center gap-3 rounded-xl border border-[#b9d8cc] bg-[#edf8f3] px-4 py-3 text-sm font-bold text-[#155d46]"><span className="h-4 w-4 animate-spin rounded-full border-2 border-[#2d9872] border-t-transparent" />{busy}</div>}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_355px]">
          <section className="min-w-0 rounded-[26px] border border-[#d8e2de] bg-white p-5 shadow-[0_14px_45px_rgba(18,48,39,.055)] sm:p-7">
            {step === 0 && (
              <div>
                <SectionTitle eyebrow="STEP 01 · 素材匯入" title="先提供這次簡報的依據" body="可同時匯入文件、試算表、PDF、文字或既有簡報範本。" />
                <div className="mt-5 grid grid-cols-2 gap-2 rounded-xl bg-[#eef3f1] p-1.5">
                  <button type="button" onClick={() => setFlowMode('source')} className={`rounded-lg px-3 py-2.5 text-sm font-black ${flowMode === 'source' ? 'bg-white text-[#126149] shadow-sm' : 'text-[#6b7974]'}`}>從資料生成簡報</button>
                  <button type="button" onClick={() => setFlowMode('template')} className={`rounded-lg px-3 py-2.5 text-sm font-black ${flowMode === 'template' ? 'bg-white text-[#126149] shadow-sm' : 'text-[#6b7974]'}`}>套用空白 PPTX 範本</button>
                </div>
                <input ref={inputRef} className="hidden" multiple type="file" accept=".pdf,.docx,.xlsx,.xls,.csv,.txt,.md,.pptx" onChange={(event) => event.target.files && addFiles(event.target.files)} />
                <div role="button" tabIndex={0} onKeyDown={(event) => event.key === 'Enter' && inputRef.current?.click()} onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); addFiles(event.dataTransfer.files); }} className="mt-5 grid min-h-44 cursor-pointer place-items-center rounded-2xl border-2 border-dashed border-[#a9c5ba] bg-[#f3faf7] px-6 text-center hover:border-[#147456] hover:bg-[#edf8f3]">
                  <span><span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#dcefe7] text-2xl text-[#126149]">＋</span><span className="mt-3 block text-lg font-black">拖曳檔案，或點擊選擇</span><span className="mt-1 block text-sm leading-6 text-[#70807a]">PDF、DOCX、XLSX、PPTX、CSV、TXT、MD｜每檔上限 25 MB</span></span>
                </div>
                {files.length > 0 && <ul className="mt-3 grid gap-2 sm:grid-cols-2">{files.map((file, index) => <li key={`${file.name}-${file.size}`} className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-[#dce5e1] px-3 py-3 text-sm"><span className="truncate font-bold">{file.name}</span><button type="button" onClick={() => setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index))} className="shrink-0 font-bold text-[#9a4f42]">移除</button></li>)}</ul>}
                <div className="my-4 flex items-center gap-3 text-sm font-bold text-[#87958f]"><span className="h-px flex-1 bg-[#e1e8e5]" />或直接輸入文字<span className="h-px flex-1 bg-[#e1e8e5]" /></div>
                <textarea value={manualText} onChange={(event) => setManualText(event.target.value)} className="min-h-36 w-full resize-y rounded-2xl border border-[#d3ddd9] px-4 py-3 text-base leading-7 outline-none placeholder:text-[#9aa6a1] focus:border-[#147456] focus:ring-2 focus:ring-[#cce8dc]" placeholder="貼上會議紀錄、研究摘要、主管交辦事項或 Markdown 大綱……" />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><button type="button" onClick={() => { setManualText(practiceData); setRequirements((current) => ({ ...current, topic: '全台住宅用電與節能宣導月報', objective: '確認高成長區的宣導資源配置' })); }} className="text-sm font-bold text-[#147456] underline underline-offset-4">載入課程練習資料</button><button type="button" disabled={!!busy} onClick={handleParse} className="rounded-xl bg-[#eaa13b] px-6 py-3 text-base font-black text-[#35220a] shadow-sm hover:bg-[#f2b45f] disabled:opacity-50">解析素材並設定任務 →</button></div>
              </div>
            )}

            {step === 1 && (
              <div>
                <SectionTitle eyebrow="STEP 02 · 設定任務" title="先把簡報任務與規則說清楚" body={`已解析 ${sources.length} 份來源、${formatNumber(sourceCharacters)} 個字元；原始檔案未寫入草稿。`} />
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <Field label="簡報主題" required><input value={requirements.topic} onChange={(event) => setRequirements({ ...requirements, topic: event.target.value })} className="field" placeholder="例如：7 月住宅用電與宣導月報" /></Field>
                  <Field label="工作情境"><select value={requirements.scenario} onChange={(event) => setRequirements({ ...requirements, scenario: event.target.value })} className="field">{scenarios.map((item) => <option key={item}>{item}</option>)}</select></Field>
                  <Field label="主要受眾"><input value={requirements.audience} onChange={(event) => setRequirements({ ...requirements, audience: event.target.value })} className="field" /></Field>
                  <Field label="希望促成的決定" required><input value={requirements.objective} onChange={(event) => setRequirements({ ...requirements, objective: event.target.value })} className="field" placeholder="例如：確認下月資源配置" /></Field>
                  <Field label="敘事結構"><select value={requirements.structure} onChange={(event) => setRequirements({ ...requirements, structure: event.target.value })} className="field">{structures.map((item) => <option key={item}>{item}</option>)}</select></Field>
                  <Field label="語氣"><input value={requirements.tone} onChange={(event) => setRequirements({ ...requirements, tone: event.target.value })} className="field" /></Field>
                  <Field label="總頁數"><input type="number" min="3" max="12" value={requirements.slideCount} onChange={(event) => setRequirements({ ...requirements, slideCount: Number(event.target.value) })} className="field" /></Field>
                  <Field label="預計講述時間（分鐘）"><input type="number" min="3" max="60" value={requirements.duration} onChange={(event) => setRequirements({ ...requirements, duration: Number(event.target.value) })} className="field" /></Field>
                  <Field label="資料分級"><select value={requirements.classification} onChange={(event) => setRequirements({ ...requirements, classification: event.target.value as Requirements['classification'] })} className="field"><option>公開</option><option>內部</option><option>機密</option></select></Field>
                  <Field label="大綱引擎"><select value={model} onChange={(event) => setModel(event.target.value)} className="field">{modelOptions.map((item) => <option key={item.value} value={item.value}>{item.label}｜{item.hint}</option>)}</select><span className="mt-2 block text-sm font-normal leading-6 text-[#66756f]">{model === 'local' ? '本機引擎只會重組原文既有敘述，不會歸納語意；建議改用有免費額度的 Gemini。' : apiKey.trim() ? '將由這台電腦直接呼叫模型，金鑰不會經過本站伺服器。' : '尚未填入金鑰；會先嘗試伺服器金鑰，若未設定則退回本機規則引擎。'}</span></Field>
                </div>
                <ApiKeyBox model={model} apiKey={apiKey} visible={keyVisible} onChange={setApiKey} onToggle={() => setKeyVisible((value) => !value)} />
                <label className="mt-4 flex items-start gap-3 rounded-xl border border-[#d9e5e0] bg-[#f6faf8] p-4 text-base"><input type="checkbox" checked={requirements.notes} onChange={(event) => setRequirements({ ...requirements, notes: event.target.checked })} className="mt-1.5 accent-[#126149]" /><span><strong>產生講者備註</strong><br /><span className="text-sm leading-6 text-[#66756f]">每頁補充說明重點與人工核對提醒。</span></span></label>
                <RulesBox />
                <div className="mt-5 flex justify-between gap-3"><button type="button" onClick={() => setStep(0)} className="secondary-button">← 返回素材</button><button type="button" disabled={!!busy} onClick={handleGenerate} className="primary-button">生成簡報大綱 →</button></div>
              </div>
            )}

            {step === 2 && deck && (
              <div>
                <SectionTitle eyebrow="STEP 03 · 證據大綱" title="逐頁確認內容與證據" body={`由 ${deck.generatedBy === 'local-rules-engine' ? '本機規則引擎（非 AI）' : `AI 模型 ${deck.generatedBy}`} 產生；所有文字仍可直接修改。`} />
                {deck.warnings.length > 0 && <div className="mt-4 rounded-xl border border-[#eed2a5] bg-[#fff9ee] p-4 text-sm leading-6 text-[#7b551f]">{deck.warnings.join(' ')}</div>}
                <div className="mt-5 space-y-3">
                  {deck.slides.map((slide, index) => <SlideEditor key={slide.id} slide={slide} index={index} total={deck.slides.length} onChange={(patch) => updateSlide(index, patch)} onMove={(direction) => setDeck({ ...deck, slides: move(deck.slides, index, index + direction) })} onDelete={() => setDeck({ ...deck, slides: deck.slides.filter((item) => item.id !== slide.id) })} />)}
                </div>
                <button type="button" onClick={() => setDeck({ ...deck, slides: [...deck.slides, { id: crypto.randomUUID(), title: '新增頁面', conclusion: '請填寫核心結論', bullets: ['請填寫重點內容'], visual: 'content', source: '來源：待指定', speakerNotes: '' }] })} className="mt-3 w-full rounded-xl border border-dashed border-[#93b5a8] py-3 text-base font-black text-[#147456] hover:bg-[#f0f8f4]">＋ 新增一頁</button>
                <div className="mt-5 flex justify-between gap-3"><button type="button" onClick={() => setStep(1)} className="secondary-button">← 修改任務</button><button type="button" onClick={confirmOutline} className="primary-button">確認大綱並選擇輸出 →</button></div>
              </div>
            )}

            {step === 3 && deck && (
              <div>
                <SectionTitle eyebrow="STEP 04 · 選擇輸出" title="同一份任務包，交給不同工具" body="這裡負責把來源、規則與大綱整理好；Gamma 負責視覺設計，NotebookLM 負責來源查證，ChatGPT／Claude 負責內容編修。" />
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  {[
                    ['Gamma 設計指令', '依已核對大綱建立 16:9 視覺簡報，保留頁尾來源。'],
                    ['NotebookLM 查證指令', '回到原始文件，核對每頁主張、數字、單位與頁碼。'],
                    ['ChatGPT／Claude 編修指令', '優化故事線與用字，但禁止新增來源外的推論。'],
                    ['Markdown 任務包', '把任務卡、品質規則、大綱與風險一次下載留存。'],
                  ].map(([title, description], index) => <div key={title} className="rounded-2xl border border-[#d7e3de] bg-[#f7faf8] p-4"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-[#dcefe7] text-base font-black text-[#126149]">{index + 1}</span><div><p className="text-base font-black">{title}</p><p className="mt-1 text-sm leading-6 text-[#64746e]">{description}</p></div></div></div>)}
                </div>
                <p className="mt-6 text-base font-black">PowerPoint 文字骨架風格（選填）</p>
                <p className="mt-1 text-sm leading-6 text-[#66756f]">需要離線編修時，可另外下載可編輯的文字與色塊骨架；風格不取代專業視覺設計。</p>
                {templateTheme && <div className="mt-4 rounded-xl border border-[#b8d8cb] bg-[#eff8f4] p-4"><p className="text-base font-black text-[#155f47]">自訂範本已就緒（MVP 樣式擷取）</p><p className="mt-1 text-sm leading-6 text-[#577168]">辨識到 {templateTheme.slideCount} 張版面、字型 {templateTheme.fontFace || '未指定'}，並取得 {templateTheme.colors.length} 個主題色。第一版會重建其配色與字型；正式母片版位保留列入下一階段。</p><div className="mt-2 flex gap-2">{templateTheme.colors.slice(0, 6).map((color) => <span key={color} className="h-5 w-5 rounded-full border border-black/10" style={{ backgroundColor: `#${color}` }} />)}</div></div>}
                <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{STYLE_PRESETS.map((style) => <button type="button" key={style.id} onClick={() => setStyleId(style.id)} className={`overflow-hidden rounded-2xl border-2 text-left transition ${styleId === style.id ? 'border-[#126149] shadow-md' : 'border-[#dce4e1] hover:border-[#9ebcaf]'}`}><div className="h-28 p-4" style={{ backgroundColor: `#${style.background}` }}><div className="h-2 w-12 rounded" style={{ backgroundColor: `#${style.accent}` }} /><div className="mt-4 h-3 w-3/4 rounded" style={{ backgroundColor: `#${style.primary}` }} /><div className="mt-3 grid grid-cols-[1fr_42px] gap-3"><div className="space-y-2"><div className="h-1.5 w-full rounded bg-black/15" /><div className="h-1.5 w-4/5 rounded bg-black/10" /></div><div className="h-9 rounded-lg" style={{ backgroundColor: `#${style.primary}` }} /></div></div><div className="border-t border-[#e1e7e4] bg-white p-3"><p className="text-base font-black">{style.name}</p><p className="mt-1 text-sm leading-6 text-[#697771]">{style.description}</p></div></button>)}</div>
                <div className="mt-5 flex justify-between gap-3"><button type="button" onClick={() => setStep(2)} className="secondary-button">← 返回大綱</button><button type="button" onClick={confirmStyle} className="primary-button">建立多工具任務包 →</button></div>
              </div>
            )}

            {step === 4 && deck && (
              <div>
                <SectionTitle eyebrow="STEP 05 · 任務包輸出" title="內容已整理，選擇下一步工具" body={`${deck.slides.length} 頁證據大綱已整合。複製對應指令即可交給外部工具，或下載 Markdown 留存與 PowerPoint 文字骨架。`} />
                {outputs && <div className="mt-5 grid gap-4 xl:grid-cols-2">
                  <OutputCard label="視覺生成" title="Gamma 設計指令" description="交給 Gamma 生成版面，已包含頁數、風格、大綱與來源規則。" value={outputs.gamma} copied={copied === 'gamma'} onCopy={() => copyOutput('gamma', outputs.gamma)} />
                  <OutputCard label="來源查證" title="NotebookLM 查證指令" description="先把相同來源上傳至 NotebookLM，再貼上這段指令取得查證表。" value={outputs.notebook} copied={copied === 'notebook'} onCopy={() => copyOutput('notebook', outputs.notebook)} />
                  <OutputCard label="內容編修" title="ChatGPT／Claude 編修指令" description="用於壓縮文字、檢查故事線與清除模糊敘述，不允許改寫原始數據。" value={outputs.llm} copied={copied === 'llm'} onCopy={() => copyOutput('llm', outputs.llm)} />
                  <div className="rounded-2xl border border-[#cbded6] bg-[#eef7f3] p-5"><p className="text-sm font-black tracking-[.1em] text-[#147456]">完整交付檔</p><h4 className="mt-1 text-xl font-black">Markdown 簡報任務包</h4><p className="mt-2 text-sm leading-6 text-[#5c6f67]">包含任務卡、品質規則、逐頁證據大綱與待補風險，適合留存、交接或貼入其他 AI。</p><textarea readOnly value={outputs.full} className="mt-4 h-44 w-full resize-none rounded-xl border border-[#b8cec5] bg-white p-4 text-sm leading-6 text-[#294038] outline-none" aria-label="完整 Markdown 簡報任務包" /><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => copyOutput('full', outputs.full)} className="secondary-button">{copied === 'full' ? '已複製' : '複製全文'}</button><button type="button" onClick={downloadTaskPack} className="primary-button">下載 .md 任務包</button></div></div>
                </div>}
                <div className="mt-5 rounded-2xl border border-[#d7e2de] bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-sm font-black tracking-[.1em] text-[#147456]">離線編修選項</p><h4 className="mt-1 text-xl font-black">PowerPoint 文字骨架</h4><p className="mt-2 max-w-2xl text-sm leading-6 text-[#5c6f67]">輸出原生可編輯文字、色塊與講者備註，適合再套用單位母片。這不是與 Gamma 競爭的完整視覺成品。</p></div><button type="button" disabled={!!busy} onClick={handleExport} className="primary-button">下載 PowerPoint 文字骨架</button></div><div className="mt-4 grid gap-3 sm:grid-cols-3">{deck.slides.slice(0, 3).map((slide, index) => <SlidePreview key={slide.id} slide={slide} index={index} style={selectedStyle} />)}</div></div>
                <div className="mt-5 rounded-2xl border border-[#d7e2de] bg-[#f5f9f7] p-5"><p className="text-base font-black">交付前人工驗收</p><div className="mt-3 grid gap-3 text-sm leading-6 text-[#556660] sm:grid-cols-2">{['數字、單位與來源已核對', '沒有把待補資料寫成事實', '每頁只有一個核心結論', '交付前已檢查機密與品牌規範'].map((item) => <label key={item} className="flex items-start gap-2"><input type="checkbox" className="mt-1.5 accent-[#126149]" />{item}</label>)}</div></div>
                <div className="mt-5 flex flex-wrap justify-between gap-3"><button type="button" onClick={() => setStep(3)} className="secondary-button">← 修改輸出</button><button type="button" onClick={() => setStep(2)} className="secondary-button">編輯證據大綱</button></div>
              </div>
            )}
          </section>

          <ProjectSidebar step={step} model={model} sources={sources} requirements={requirements} deck={deck} styleName={selectedStyle.name} />
        </div>
      </section>
    </main>
  );
}

function ApiKeyBox({ model, apiKey, visible, onChange, onToggle }: { model: string; apiKey: string; visible: boolean; onChange: (value: string) => void; onToggle: () => void }) {
  if (model === 'local') return null;
  const provider = PROVIDER_INFO[providerOf(model)];
  const filled = apiKey.trim().length > 0;
  const looksWrong = filled && !apiKey.trim().startsWith(provider.keyPrefix);
  return (
    <div className="mt-4 rounded-xl border border-[#d9e5e0] bg-[#f6faf8] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-base font-black">{provider.name} 金鑰</p>
        <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="text-sm font-bold text-[#147456] underline">申請金鑰 ↗</a>
      </div>
      <div className="mt-2 flex gap-2">
        <input type={visible ? 'text' : 'password'} value={apiKey} onChange={(event) => onChange(event.target.value)} className="field flex-1" placeholder={`${provider.keyPrefix}…`} autoComplete="off" spellCheck={false} />
        <button type="button" onClick={onToggle} className="secondary-button whitespace-nowrap">{visible ? '隱藏' : '顯示'}</button>
      </div>
      <p className="mt-2 text-sm leading-6 text-[#66756f]">
        金鑰只存在這台電腦的 localStorage，僅由瀏覽器直接送往 {provider.name}，不會經過本站伺服器，也不會寫入草稿或任務包。
        {looksWrong && <span className="block font-bold text-[#a4552f]">這組金鑰不是 {provider.keyPrefix}… 開頭，請確認是否貼錯供應商。</span>}
        {!filled && <span className="block">留空則會改用伺服器金鑰（若管理者已設定），否則退回本機規則引擎。</span>}
      </p>
    </div>
  );
}

function SectionTitle({ eyebrow, title, body }: { eyebrow: string; title: string; body: string }) {
  return <div><p className="text-sm font-black tracking-[.12em] text-[#147456]">{eyebrow}</p><h3 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl">{title}</h3><p className="mt-2 text-base leading-7 text-[#66756f]">{body}</p></div>;
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return <label className="text-base font-black text-[#2c4038]">{label}{required && <span className="ml-1 text-[#c55b46]">*</span>}{children}</label>;
}

function RulesBox() {
  return <div className="mt-4 rounded-2xl bg-[#102c24] p-5 text-white"><div className="flex items-center justify-between gap-3"><p className="text-base font-black">課程 Rules 已自動套用</p><span className="rounded-full bg-[#9cdfc5] px-3 py-1 text-xs font-black text-[#102c24]">品質防線</span></div><ul className="mt-3 grid gap-2 text-sm leading-6 text-white/75 sm:grid-cols-2"><li>• 頁標題 15 字以內</li><li>• 核心結論 20 字以內</li><li>• 每頁最多 4 點、每點 30 字</li><li>• 數據保留單位與來源</li><li>• 不使用模糊形容詞</li><li>• 無依據內容標示待補資料</li></ul></div>;
}

function OutputCard({ label, title, description, value, copied, onCopy }: { label: string; title: string; description: string; value: string; copied: boolean; onCopy: () => void }) {
  return <article className="rounded-2xl border border-[#d7e2de] bg-white p-5"><div className="flex items-start justify-between gap-4"><div><p className="text-sm font-black tracking-[.1em] text-[#147456]">{label}</p><h4 className="mt-1 text-xl font-black">{title}</h4></div><button type="button" onClick={onCopy} className="secondary-button shrink-0">{copied ? '已複製' : '複製指令'}</button></div><p className="mt-2 text-sm leading-6 text-[#5c6f67]">{description}</p><textarea readOnly value={value} className="mt-4 h-56 w-full resize-none rounded-xl border border-[#d1ddd8] bg-[#f7faf8] p-4 text-sm leading-6 text-[#294038] outline-none" aria-label={title} /></article>;
}

function SlideEditor({ slide, index, total, onChange, onMove, onDelete }: { slide: DeckSlide; index: number; total: number; onChange: (patch: Partial<DeckSlide>) => void; onMove: (direction: number) => void; onDelete: () => void }) {
  return <article className="rounded-2xl border border-[#d9e3df] p-4"><div className="mb-3 flex items-center justify-between gap-3"><div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-[#e5f2ed] text-sm font-black text-[#126149]">{index + 1}</span><select value={slide.visual} onChange={(event) => onChange({ visual: event.target.value as DeckSlide['visual'] })} className="rounded-lg border border-[#d5dfdb] px-3 py-2 text-sm font-bold"><option value="cover">封面</option><option value="content">內容</option><option value="data">數據</option><option value="comparison">比較</option><option value="section">章節</option><option value="conclusion">結論</option></select></div><div className="flex gap-1"><button type="button" disabled={index === 0} onClick={() => onMove(-1)} className="tiny-button">↑</button><button type="button" disabled={index === total - 1} onClick={() => onMove(1)} className="tiny-button">↓</button><button type="button" disabled={total <= 2} onClick={onDelete} className="tiny-button text-[#a24838]">刪</button></div></div><div className="grid gap-3"><input value={slide.title} maxLength={30} onChange={(event) => onChange({ title: event.target.value })} className="field font-black" aria-label={`第 ${index + 1} 頁標題`} /><input value={slide.conclusion} maxLength={50} onChange={(event) => onChange({ conclusion: event.target.value })} className="field text-[#126149]" aria-label={`第 ${index + 1} 頁核心結論`} />{slide.visual !== 'cover' && <textarea value={slide.bullets.join('\n')} onChange={(event) => onChange({ bullets: event.target.value.split('\n').filter(Boolean).slice(0, 4) })} className="field min-h-28 resize-y leading-7" aria-label={`第 ${index + 1} 頁重點內容`} placeholder="每行一點，最多 4 點" />}<input value={slide.source} onChange={(event) => onChange({ source: event.target.value })} className="field" aria-label={`第 ${index + 1} 頁來源`} /></div></article>;
}

function SlidePreview({ slide, index, style }: { slide: DeckSlide; index: number; style: typeof STYLE_PRESETS[number] }) {
  const cover = index === 0 || slide.visual === 'cover';
  return <div className="aspect-video overflow-hidden rounded-xl border border-black/10 shadow-sm" style={{ backgroundColor: `#${cover ? style.primary : style.background}`, color: `#${cover ? 'FFFFFF' : style.text}` }}><div className="flex h-full"><span className="w-1.5 shrink-0" style={{ backgroundColor: `#${style.accent}` }} /><div className="min-w-0 flex-1 p-[5%]"><p className="truncate text-xs font-black sm:text-sm">{slide.title}</p><p className="mt-[4%] line-clamp-2 text-[10px] font-bold opacity-80 sm:text-xs">{slide.conclusion}</p>{!cover && <ul className="mt-[5%] space-y-[3%] text-[9px] leading-tight opacity-75 sm:text-[10px]">{slide.bullets.slice(0, 4).map((bullet) => <li key={bullet} className="truncate">• {bullet}</li>)}</ul>}<span className="absolute" /></div><span className="self-end p-2 text-[9px] opacity-50">{index + 1}</span></div></div>;
}

function ProjectSidebar({ step, model, sources, requirements, deck, styleName }: { step: number; model: string; sources: ParsedSource[]; requirements: Requirements; deck: DeckSpec | null; styleName: string }) {
  const modelLabel = modelOptions.find((item) => item.value === model)?.label ?? model;
  const status = [sources.length ? '已解析' : '待匯入', step >= 1 ? '已設定' : '待設定', deck ? '已產生' : '待產生', step >= 4 ? '已建立' : '待建立'];
  return <aside className="h-fit rounded-[26px] bg-[#102c24] p-5 text-white shadow-[0_18px_50px_rgba(10,40,31,.13)] lg:sticky lg:top-24"><div className="flex items-center justify-between gap-3"><p className="text-sm font-black tracking-[.12em] text-[#9cdfc5]">即時任務摘要</p><span className="rounded-full border border-white/15 px-2.5 py-1 text-xs text-white/65">本機自動儲存</span></div><h3 className="mt-4 truncate text-xl font-black">{requirements.topic || '尚未命名的簡報'}</h3><p className="mt-1 text-sm leading-6 text-white/60">{requirements.audience}｜{requirements.classification}</p><div className="mt-5 space-y-2">{[['來源素材', sources.length ? `${sources.length} 份` : '未提供'], ['大綱引擎', modelLabel], ['證據大綱', deck ? `${deck.slides.length} 頁` : `${requirements.slideCount} 頁`], ['任務包', step >= 4 ? '已可下載' : styleName]].map(([label, value], index) => <div key={label} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[.045] p-3"><div><p className="text-xs font-bold text-white/50">{label}</p><p className="mt-0.5 text-sm font-black">{value}</p></div><span className={`h-2.5 w-2.5 rounded-full ${status[index].startsWith('待') ? 'bg-white/20' : 'bg-[#76ddb5]'}`} /></div>)}</div><div className="mt-5 rounded-xl border border-[#eaa13b]/35 bg-[#eaa13b]/10 p-4 text-sm leading-6 text-[#ffe0ad]">AI 只能使用提供的資料。找不到依據的數字、原因或成效，會標示為「待補資料」。</div><p className="mt-4 text-xs leading-5 text-white/45">MVP 安全設計：原始檔案於瀏覽器解析；草稿只保存需求、大綱與風格，不保存原始文件內容。</p></aside>;
}
