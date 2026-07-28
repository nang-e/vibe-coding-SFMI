import { describe, it, expect, vi } from 'vitest';
import { buildPredictionDraft } from '../lib/predict';
import { chatJSON } from '../lib/openrouterClient';

vi.mock('../lib/openrouterClient', () => ({
  chatJSON: vi.fn(),
  MODEL_NAME: 'openai/gpt-oss-20b:free',
}));

describe('buildPredictionDraft', () => {
  it('asks the LLM to synthesize stats + news context into a prediction', async () => {
    (chatJSON as any).mockResolvedValue(
      JSON.stringify({
        direction: 'down',
        rangeLow: -4,
        rangeHigh: -2,
        confidence: 0.4,
        reasoning: '과거 3건 평균 -3% 하락, 이번 뉴스도 유사한 부정적 맥락',
      }),
    );

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
    expect(chatJSON).toHaveBeenCalledWith(expect.stringContaining('축산업'));
  });

  it('throws when the LLM returns no content', async () => {
    (chatJSON as any).mockResolvedValue('');

    await expect(
      buildPredictionDraft({
        themeName: '반도체',
        recentNewsSummaries: [],
        stats: { sampleSize: 0, avgChangePct: null, minChangePct: null, maxChangePct: null, lowSample: true },
      }),
    ).rejects.toThrow();
  });
});
