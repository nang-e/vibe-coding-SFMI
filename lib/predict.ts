import { Type, type Schema } from '@google/genai';
import { getGemini, REASONING_MODEL } from './geminiClient';
import type { ThemeReactionStats } from './stats';

export interface PredictionDraft {
  direction: 'up' | 'down';
  rangeLow: number;
  rangeHigh: number;
  confidence: number;
  reasoning: string;
}

const PREDICTION_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    direction: { type: Type.STRING, format: 'enum', enum: ['up', 'down'] },
    rangeLow: { type: Type.NUMBER },
    rangeHigh: { type: Type.NUMBER },
    confidence: { type: Type.NUMBER },
    reasoning: { type: Type.STRING },
  },
  required: ['direction', 'rangeLow', 'rangeHigh', 'confidence', 'reasoning'],
};

export async function buildPredictionDraft(input: {
  themeName: string;
  recentNewsSummaries: string[];
  stats: ThemeReactionStats;
}): Promise<PredictionDraft> {
  const gemini = getGemini();
  const statsText = input.stats.sampleSize === 0
    ? '과거 유사 사례 없음'
    : `과거 ${input.stats.sampleSize}건 기준 평균 ${input.stats.avgChangePct?.toFixed(1)}% 변동 (최소 ${input.stats.minChangePct}%, 최대 ${input.stats.maxChangePct}%)${input.stats.lowSample ? ' — 표본이 적어 참고용' : ''}`;

  const response = await gemini.models.generateContent({
    model: REASONING_MODEL,
    contents: `테마: ${input.themeName}\n최근 뉴스: ${input.recentNewsSummaries.join(' / ')}\n과거 통계: ${statsText}\n\n위 정보를 종합해 이 테마의 예상 주가 흐름(방향, 변동 범위, 신뢰도, 근거)을 기록해줘. 표본이 적으면 confidence를 낮게 잡아줘.`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: PREDICTION_RESPONSE_SCHEMA,
    },
  });

  if (!response.text) throw new Error('Gemini did not return a prediction');
  return JSON.parse(response.text) as PredictionDraft;
}
