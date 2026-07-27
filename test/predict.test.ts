import { describe, it, expect, vi } from 'vitest';
import { buildPredictionDraft } from '../lib/predict';
import { getClaude } from '../lib/claudeClient';

vi.mock('../lib/claudeClient', () => ({
  getClaude: vi.fn(),
  REASONING_MODEL: 'claude-sonnet-5',
}));

describe('buildPredictionDraft', () => {
  it('asks Claude to synthesize stats + news context into a prediction', async () => {
    const mockCreate = vi.fn(async () => ({
      content: [
        {
          type: 'tool_use',
          input: {
            direction: 'down',
            rangeLow: -4,
            rangeHigh: -2,
            confidence: 0.4,
            reasoning: '과거 3건 평균 -3% 하락, 이번 뉴스도 유사한 부정적 맥락',
          },
        },
      ],
    }));
    (getClaude as any).mockReturnValue({ messages: { create: mockCreate } });

    const draft = await buildPredictionDraft({
      themeName: '축산업',
      recentNewsSummaries: ['월가발 조류독감 확산 뉴스'],
      stats: { sampleSize: 3, avgChangePct: -3, minChangePct: -5, maxChangePct: -1, lowSample: false },
    });

    expect(draft).toEqual({
      direction: 'down',
      rangeLow: -4,
      rangeHigh: -2,
      confidence: 0.4,
      reasoning: '과거 3건 평균 -3% 하락, 이번 뉴스도 유사한 부정적 맥락',
    });
  });
});
