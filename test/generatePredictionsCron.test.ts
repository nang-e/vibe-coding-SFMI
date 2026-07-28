import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('../lib/supabaseClient', () => ({ getSupabase: () => ({ from: mockFrom }) }));

vi.mock('../lib/stats', () => ({
  fetchThemeReactionHistory: vi.fn(async () => []),
  computeThemeReactionStats: vi.fn(() => ({
    sampleSize: 0,
    avgChangePct: null,
    minChangePct: null,
    maxChangePct: null,
    lowSample: true,
  })),
}));

const mockBuildPredictionDraft = vi.fn();
vi.mock('../lib/predict', () => ({ buildPredictionDraft: (...args: any[]) => mockBuildPredictionDraft(...args) }));

import { ApiError } from '@google/genai';
import { run } from '../api/cron/generate-predictions';

function tagRow(themeId: string, themeName: string, sentiment: string, title: string) {
  return { theme_id: themeId, sentiment, reasoning: 'r', themes: { name: themeName }, news_items: { title } };
}

describe('generate-predictions run()', () => {
  beforeEach(() => {
    mockBuildPredictionDraft.mockReset();
  });

  it('stops early on the first rate-limit (429) error and records one failure noting the early stop', async () => {
    const tags = [
      tagRow('t1', '반도체', 'positive', '뉴스1'),
      tagRow('t2', '바이오', 'negative', '뉴스2'),
      tagRow('t3', '2차전지', 'positive', '뉴스3'),
    ];

    const insertMock = vi.fn(async () => ({ error: null }));
    mockFrom.mockImplementation((table: string) => {
      if (table === 'news_tags') {
        return {
          select: () => ({
            neq: () => ({
              gte: () => Promise.resolve({ data: tags, error: null }),
            }),
          }),
        };
      }
      if (table === 'predictions') {
        return { insert: insertMock };
      }
      return {};
    });

    mockBuildPredictionDraft
      .mockResolvedValueOnce({ direction: 'up', rangeLow: 1, rangeHigh: 2, confidence: 0.5, reasoning: 'ok' })
      .mockRejectedValueOnce(new ApiError({ message: 'rate limited', status: 429 }));

    const result = await run();

    // Third theme group is never attempted — the loop breaks right after the 429.
    expect(mockBuildPredictionDraft).toHaveBeenCalledTimes(2);
    expect(result.created).toBe(1);
    expect(result.failures).toEqual(['rate limited, stopping early after 1 items']);
  });
});
