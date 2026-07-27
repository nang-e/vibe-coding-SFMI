import { getClaude, REASONING_MODEL } from './claudeClient';
import type { ThemeReactionStats } from './stats';

export interface PredictionDraft {
  direction: 'up' | 'down';
  rangeLow: number;
  rangeHigh: number;
  confidence: number;
  reasoning: string;
}

const PREDICTION_TOOL = {
  name: 'record_prediction',
  description: '과거 통계와 최근 뉴스 맥락을 종합해 테마의 예상 주가 흐름을 기록한다.',
  input_schema: {
    type: 'object' as const,
    properties: {
      direction: { type: 'string', enum: ['up', 'down'] },
      rangeLow: { type: 'number' },
      rangeHigh: { type: 'number' },
      confidence: { type: 'number' },
      reasoning: { type: 'string' },
    },
    required: ['direction', 'rangeLow', 'rangeHigh', 'confidence', 'reasoning'],
  },
};

export async function buildPredictionDraft(input: {
  themeName: string;
  recentNewsSummaries: string[];
  stats: ThemeReactionStats;
}): Promise<PredictionDraft> {
  const claude = getClaude();
  const statsText = input.stats.sampleSize === 0
    ? '과거 유사 사례 없음'
    : `과거 ${input.stats.sampleSize}건 기준 평균 ${input.stats.avgChangePct?.toFixed(1)}% 변동 (최소 ${input.stats.minChangePct}%, 최대 ${input.stats.maxChangePct}%)${input.stats.lowSample ? ' — 표본이 적어 참고용' : ''}`;

  const response = await claude.messages.create({
    model: REASONING_MODEL,
    max_tokens: 1024,
    tools: [PREDICTION_TOOL],
    tool_choice: { type: 'tool', name: 'record_prediction' },
    messages: [
      {
        role: 'user',
        content: `테마: ${input.themeName}\n최근 뉴스: ${input.recentNewsSummaries.join(' / ')}\n과거 통계: ${statsText}\n\n위 정보를 종합해 이 테마의 예상 주가 흐름(방향, 변동 범위, 신뢰도, 근거)을 기록해줘. 표본이 적으면 confidence를 낮게 잡아줘.`,
      },
    ],
  });

  const toolUse = response.content.find((c): c is any => c.type === 'tool_use');
  if (!toolUse) throw new Error('Claude did not return a prediction');
  return toolUse.input as PredictionDraft;
}
