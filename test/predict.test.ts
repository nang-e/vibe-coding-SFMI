import { describe, it, expect, vi } from 'vitest';
import { Type } from '@google/genai';
import { buildPredictionDraft } from '../lib/predict';
import { getGemini } from '../lib/geminiClient';

vi.mock('../lib/geminiClient', () => ({
  getGemini: vi.fn(),
  REASONING_MODEL: 'gemini-flash-latest',
}));

describe('buildPredictionDraft', () => {
  it('asks Gemini to synthesize stats + news context into a prediction', async () => {
    const mockGenerateContent = vi.fn(async () => ({
      text: JSON.stringify({
        direction: 'down',
        rangeLow: -4,
        rangeHigh: -2,
        confidence: 0.4,
        reasoning: '과거 3건 평균 -3% 하락, 이번 뉴스도 유사한 부정적 맥락',
      }),
    }));
    (getGemini as any).mockReturnValue({ models: { generateContent: mockGenerateContent } });

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
    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-flash-latest',
        contents: expect.stringContaining('축산업'),
        config: expect.objectContaining({
          responseMimeType: 'application/json',
          responseSchema: expect.objectContaining({
            type: Type.OBJECT,
            required: ['direction', 'rangeLow', 'rangeHigh', 'confidence', 'reasoning'],
            properties: expect.objectContaining({
              direction: expect.objectContaining({ type: Type.STRING }),
            }),
          }),
        }),
      }),
    );
  });
});
