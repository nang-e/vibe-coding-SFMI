import { chatJSON, MODEL_NAME } from './openrouterClient';
import type { ThemeReactionStats } from './stats';

export interface PredictionDraft {
  direction: 'up' | 'down';
  rangeLow: number;
  rangeHigh: number;
  confidence: number;
  reasoning: string;
}

export async function buildPredictionDraft(input: {
  themeName: string;
  recentNewsSummaries: string[];
  stats: ThemeReactionStats;
}): Promise<PredictionDraft> {
  const statsText = input.stats.sampleSize === 0
    ? '과거 유사 사례 없음'
    : `과거 ${input.stats.sampleSize}건 기준 평균 ${input.stats.avgChangePct?.toFixed(1)}% 변동 (최소 ${input.stats.minChangePct}%, 최대 ${input.stats.maxChangePct}%)${input.stats.lowSample ? ' — 표본이 적어 참고용' : ''}`;

  const prompt = `테마: ${input.themeName}\n최근 뉴스: ${input.recentNewsSummaries.join(' / ')}\n과거 통계: ${statsText}\n\n위 정보를 종합해 이 테마의 예상 주가 흐름을 판단해줘. 표본이 적으면 confidence를 낮게 잡아줘.\n\n반드시 아래 형식의 JSON 객체 하나만 답해. 다른 설명이나 마크다운 코드블록 없이 JSON만 출력해:\n{"direction": "up 또는 down", "rangeLow": 숫자, "rangeHigh": 숫자, "confidence": 0~1 사이 숫자, "reasoning": "한국어 근거 문자열"}`;

  const content = await chatJSON(prompt);
  if (!content) throw new Error(`${MODEL_NAME} did not return a prediction`);
  return JSON.parse(content) as PredictionDraft;
}
