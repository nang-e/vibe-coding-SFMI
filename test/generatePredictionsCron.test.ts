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

let overseasPeers: Record<string, { ticker: string; name: string }[]> = {};
const mockFetchOverseasSignals = vi.fn(async () => []);
vi.mock('../lib/overseasSignal', () => ({
  get THEME_OVERSEAS_PEERS() { return overseasPeers; },
  fetchOverseasSignals: (...args: any[]) => mockFetchOverseasSignals(...args),
}));

const mockSendKakaoMemo = vi.fn(async () => {});
vi.mock('../lib/kakaoMemo', () => ({ sendKakaoMemo: (...args: any[]) => mockSendKakaoMemo(...args) }));

import { ApiError } from '@google/genai';
import { run } from '../api/cron/generate-predictions';

function tagRow(themeId: string, themeName: string, sentiment: string, title: string) {
  return { theme_id: themeId, sentiment, reasoning: 'r', themes: { name: themeName }, news_items: { title } };
}

function chainable(result: any) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    neq: () => chain,
    gte: () => chain,
    limit: () => Promise.resolve(result),
    then: (resolve: any) => resolve(result),
  };
  return chain;
}

describe('generate-predictions run()', () => {
  beforeEach(() => {
    mockBuildPredictionDraft.mockReset();
    mockFetchOverseasSignals.mockReset().mockResolvedValue([]);
    mockSendKakaoMemo.mockReset().mockResolvedValue(undefined);
    overseasPeers = {}; // no overseas path unless a test opts in
  });

  it('stops early on the first rate-limit (429) error and records one failure noting the early stop', async () => {
    const tags = [
      tagRow('t1', '반도체', 'positive', '뉴스1'),
      tagRow('t2', '바이오', 'negative', '뉴스2'),
      tagRow('t3', '2차전지', 'positive', '뉴스3'),
    ];

    const insertMock = vi.fn(async () => ({ error: null }));
    mockFrom.mockImplementation((table: string) => {
      if (table === 'themes') return chainable({ data: [], error: null });
      if (table === 'news_tags') return chainable({ data: tags, error: null });
      if (table === 'predictions') {
        return {
          select: () => chainable({ data: [], error: null }), // no cooldown hits
          insert: insertMock,
        };
      }
      return chainable({ data: [], error: null });
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

  it('skips a theme that already has a prediction within the cooldown window', async () => {
    const tags = [tagRow('t1', '반도체', 'positive', '뉴스1')];

    mockFrom.mockImplementation((table: string) => {
      if (table === 'themes') return chainable({ data: [], error: null });
      if (table === 'news_tags') return chainable({ data: tags, error: null });
      if (table === 'predictions') {
        return {
          select: () => chainable({ data: [{ id: 'existing' }], error: null }), // cooldown hit
          insert: vi.fn(),
        };
      }
      return chainable({ data: [], error: null });
    });

    const result = await run();

    expect(mockBuildPredictionDraft).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
  });

  it('pushes a Kakao memo when the predicted range is at least 1%, not when it stays under', async () => {
    const tags = [
      tagRow('t1', '반도체', 'positive', '뉴스1'),
      tagRow('t2', '바이오', 'positive', '뉴스2'),
    ];

    mockFrom.mockImplementation((table: string) => {
      if (table === 'themes') return chainable({ data: [], error: null });
      if (table === 'news_tags') return chainable({ data: tags, error: null });
      if (table === 'predictions') {
        return { select: () => chainable({ data: [], error: null }), insert: vi.fn(async () => ({ error: null })) };
      }
      return chainable({ data: [], error: null });
    });

    mockBuildPredictionDraft
      .mockResolvedValueOnce({ direction: 'up', rangeLow: 1.5, rangeHigh: 3, confidence: 0.4, reasoning: '반도체 근거' })
      .mockResolvedValueOnce({ direction: 'up', rangeLow: 0.2, rangeHigh: 0.6, confidence: 0.3, reasoning: '바이오 근거' });

    const result = await run();

    expect(result.created).toBe(2);
    expect(result.pushed).toBe(1);
    expect(mockSendKakaoMemo).toHaveBeenCalledTimes(1);
    expect(mockSendKakaoMemo).toHaveBeenCalledWith(expect.stringContaining('반도체 근거'));
  });

  it('generates an overseas-signal prediction for a theme with no fresh domestic news, citing the peers', async () => {
    overseasPeers = { 반도체: [{ ticker: 'NVDA', name: '엔비디아' }] };
    mockFetchOverseasSignals.mockResolvedValue([{ ticker: 'NVDA', name: '엔비디아', changePct: -3.2 }]);

    const insertMock = vi.fn(async () => ({ error: null }));
    mockFrom.mockImplementation((table: string) => {
      if (table === 'themes') return chainable({ data: [{ id: 'semi-theme-id', name: '반도체' }], error: null });
      if (table === 'news_tags') return chainable({ data: [], error: null }); // no domestic news at all
      if (table === 'predictions') {
        return { select: () => chainable({ data: [], error: null }), insert: insertMock };
      }
      return chainable({ data: [], error: null });
    });

    mockBuildPredictionDraft.mockResolvedValue({
      direction: 'down',
      rangeLow: -3,
      rangeHigh: -1,
      confidence: 0.3,
      reasoning: '엔비디아 하락 반영',
    });

    const result = await run();

    expect(mockBuildPredictionDraft).toHaveBeenCalledWith(expect.objectContaining({
      themeName: '반도체',
      recentNewsSummaries: [expect.stringContaining('엔비디아(NVDA) -3.2%')],
    }));
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({
      theme_id: 'semi-theme-id',
      reasoning: expect.stringContaining('[해외 선행지표]'),
    }));
    expect(result.created).toBe(1);
    expect(result.pushed).toBe(1);
  });

  it('does not generate an overseas prediction when peer moves stay under the threshold', async () => {
    overseasPeers = { 반도체: [{ ticker: 'NVDA', name: '엔비디아' }] };
    mockFetchOverseasSignals.mockResolvedValue([{ ticker: 'NVDA', name: '엔비디아', changePct: 0.3 }]);

    mockFrom.mockImplementation((table: string) => {
      if (table === 'themes') return chainable({ data: [{ id: 'semi-theme-id', name: '반도체' }], error: null });
      if (table === 'news_tags') return chainable({ data: [], error: null });
      if (table === 'predictions') return { select: () => chainable({ data: [], error: null }), insert: vi.fn() };
      return chainable({ data: [], error: null });
    });

    const result = await run();

    expect(mockBuildPredictionDraft).not.toHaveBeenCalled();
    expect(result.created).toBe(0);
  });
});
