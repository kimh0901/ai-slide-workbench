import type { DeckSpec, Requirements } from './types';
import { SYSTEM_PROMPT, buildUserPrompt, parseModelJson, validateDeck } from './deck';

export type ProviderId = 'gemini' | 'openai';

export type ModelOption = {
  value: string;
  provider: ProviderId;
  label: string;
  hint: string;
};

/** 免費額度優先：Gemini Flash 不需信用卡即可申請金鑰。 */
export const MODEL_OPTIONS: ModelOption[] = [
  { value: 'gemini-2.5-flash', provider: 'gemini', label: 'Gemini 2.5 Flash', hint: '推薦｜有免費額度，長文件速度快' },
  { value: 'gemini-2.5-pro', provider: 'gemini', label: 'Gemini 2.5 Pro', hint: '歸納品質最好，速度較慢' },
  { value: 'gpt-5-mini', provider: 'openai', label: 'OpenAI GPT-5 mini', hint: '結構穩定，需付費金鑰' },
  { value: 'gpt-5', provider: 'openai', label: 'OpenAI GPT-5', hint: '品質最高，成本最高' },
];

export const PROVIDER_INFO: Record<ProviderId, { name: string; keyPrefix: string; keyUrl: string }> = {
  gemini: { name: 'Google Gemini', keyPrefix: 'AI', keyUrl: 'https://aistudio.google.com/apikey' },
  openai: { name: 'OpenAI', keyPrefix: 'sk-', keyUrl: 'https://platform.openai.com/api-keys' },
};

export function providerOf(model: string): ProviderId {
  return MODEL_OPTIONS.find((option) => option.value === model)?.provider ?? 'gemini';
}

export class ModelError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'ModelError';
  }
}

function describeStatus(status: number, provider: ProviderId) {
  if (status === 401 || status === 403) return new ModelError(`${PROVIDER_INFO[provider].name} 拒絕這組金鑰（${status}），請確認金鑰是否正確且已啟用。`, false);
  if (status === 429) return new ModelError(`${PROVIDER_INFO[provider].name} 已達速率或額度上限（429），請稍候再試。`, true);
  if (status >= 500) return new ModelError(`${PROVIDER_INFO[provider].name} 服務暫時異常（${status}）。`, true);
  return new ModelError(`${PROVIDER_INFO[provider].name} 回應 ${status}。`, false);
}

async function callGemini(model: string, apiKey: string, prompt: string, signal?: AbortSignal) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: 'POST',
    // 金鑰放 header 而非查詢字串，避免出現在網址、瀏覽器記錄或伺服器日誌中
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    signal,
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.25, maxOutputTokens: 8192 },
    }),
  });
  if (!response.ok) throw describeStatus(response.status, 'gemini');
  const data = await response.json() as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('') ?? '';
  if (!text.trim()) throw new ModelError('Gemini 沒有回傳內容，可能被安全設定攔截或輸入過長。', true);
  return text;
}

async function callOpenAI(model: string, apiKey: string, prompt: string, signal?: AbortSignal) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    signal,
    body: JSON.stringify({
      model,
      instructions: SYSTEM_PROMPT,
      input: prompt,
      text: { format: { type: 'json_object' } },
    }),
  });
  if (!response.ok) throw describeStatus(response.status, 'openai');
  const data = await response.json() as {
    output_text?: string;
    output?: { content?: { text?: string }[] }[];
  };
  const text = data.output_text
    ?? data.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? '').join('')
    ?? '';
  if (!text.trim()) throw new ModelError('OpenAI 沒有回傳內容。', true);
  return text;
}

export type GenerateInput = {
  model: string;
  apiKey: string;
  sourceText: string;
  sourceNames: string[];
  requirements: Requirements;
  signal?: AbortSignal;
};

/**
 * 呼叫模型並取得已驗證的大綱。可在瀏覽器（使用者金鑰）或 Worker（伺服器金鑰）執行。
 * 模型輸出無法解析時會自動重試一次，仍失敗才拋出，交由呼叫端決定是否改用本機引擎。
 */
export async function generateDeck(input: GenerateInput): Promise<DeckSpec> {
  const provider = providerOf(input.model);
  const prompt = buildUserPrompt(input.requirements, input.sourceText, input.sourceNames);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const text = provider === 'gemini'
      ? await callGemini(input.model, input.apiKey, attempt === 0 ? prompt : `${prompt}\n\n【提醒】上一次的輸出不是合法 JSON。請只輸出 JSON 物件本身。`, input.signal)
      : await callOpenAI(input.model, input.apiKey, attempt === 0 ? prompt : `${prompt}\n\n【提醒】上一次的輸出不是合法 JSON。請只輸出 JSON 物件本身。`, input.signal);

    try {
      const deck = validateDeck(parseModelJson(text), input.requirements, input.model);
      if (deck) return deck;
      lastError = new ModelError('模型回傳的大綱結構不完整。', true);
    } catch (reason) {
      lastError = new ModelError(`無法解析模型輸出：${reason instanceof Error ? reason.message : '格式錯誤'}`, true);
    }
  }

  throw lastError ?? new ModelError('大綱生成失敗。', true);
}
