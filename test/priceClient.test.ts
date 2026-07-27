import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchDailyCloses, fetchLatestQuote } from '../lib/priceClient';

const chartResponse = {
  chart: {
    result: [
      {
        meta: { regularMarketPrice: 71500, chartPreviousClose: 70000 },
        timestamp: [1700000000, 1700086400],
        indicators: { quote: [{ close: [70000, 71500] }] },
      },
    ],
  },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => chartResponse,
  })));
});

describe('fetchDailyCloses', () => {
  it('maps timestamps and closes into date/close pairs', async () => {
    const result = await fetchDailyCloses('005930.KS', 2);
    expect(result).toEqual([
      { date: '2023-11-14', close: 70000 },
      { date: '2023-11-15', close: 71500 },
    ]);
  });
});

describe('fetchLatestQuote', () => {
  it('computes changePct from meta fields', async () => {
    const result = await fetchLatestQuote('005930.KS');
    expect(result.price).toBe(71500);
    expect(result.changePct).toBeCloseTo(2.142, 2);
  });
});
