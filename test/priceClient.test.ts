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
  it('computes changePct from meta fields when they agree with the daily series', async () => {
    const result = await fetchLatestQuote('005930.KS');
    expect(result.price).toBe(71500);
    expect(result.changePct).toBeCloseTo(2.142, 2);
  });

  it('uses the second-to-last daily close, not meta.chartPreviousClose, when they disagree', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        chart: {
          result: [
            {
              // meta.chartPreviousClose reflects a stale reference (e.g. ~6 sessions back
              // for a 5d range) while the daily series' actual previous close is 71000.
              meta: { regularMarketPrice: 71500, chartPreviousClose: 62000 },
              timestamp: [1699800000, 1699886400, 1699972800, 1700059200, 1700086400],
              indicators: { quote: [{ close: [60000, 61000, 62000, 71000, 71500] }] },
            },
          ],
        },
      }),
    })));

    const result = await fetchLatestQuote('005930.KS');
    expect(result.price).toBe(71500);
    // (71500 - 71000) / 71000 * 100, not (71500 - 62000) / 62000 * 100
    expect(result.changePct).toBeCloseTo(0.704, 2);
  });
});
