import type { Requirements } from '../../../lib/types';
import { buildLocalDeck } from '../../../lib/deck';
import { generateDeck } from '../../../lib/providers';

type GenerateBody = {
  model: string;
  sourceText: string;
  sourceNames: string[];
  requirements: Requirements;
};

const MAX_SOURCE = 160_000;

/**
 * 這條路由只服務「由管理者在伺服器設定金鑰」的組織部署情境。
 * 一般使用者的自備金鑰（BYOK）由瀏覽器直接呼叫模型，金鑰不會經過本站伺服器。
 */
export async function POST(request: Request) {
  let body: GenerateBody;
  try {
    body = await request.json() as GenerateBody;
  } catch {
    return Response.json({ error: '輸入格式不完整。' }, { status: 400 });
  }

  if (!body?.requirements || typeof body.sourceText !== 'string' || typeof body.model !== 'string') {
    return Response.json({ error: '輸入格式不完整。' }, { status: 400 });
  }
  const sourceText = body.sourceText.slice(0, MAX_SOURCE);
  const sourceNames = Array.isArray(body.sourceNames) ? body.sourceNames.map(String) : [];

  const apiKey = body.model.startsWith('gemini') ? process.env.GEMINI_API_KEY : process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return Response.json(buildLocalDeck(
      body.requirements,
      sourceText,
      sourceNames,
      '這台伺服器沒有設定模型金鑰，目前使用本機規則引擎：只會重組來源既有敘述，不會進行語意歸納。請在上一步填入自己的金鑰以取得 AI 大綱。',
    ));
  }

  try {
    return Response.json(await generateDeck({ model: body.model, apiKey, sourceText, sourceNames, requirements: body.requirements }));
  } catch (reason) {
    const detail = reason instanceof Error ? reason.message : '未知錯誤';
    return Response.json(buildLocalDeck(
      body.requirements,
      sourceText,
      sourceNames,
      `模型呼叫失敗（${detail}），已改用本機規則引擎。請確認金鑰與額度後重新生成。`,
    ));
  }
}
