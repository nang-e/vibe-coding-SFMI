import { describe, it, expect, vi } from 'vitest';

const mockFrom = vi.fn();
vi.mock('../lib/supabaseClient', () => ({ getSupabase: () => ({ from: mockFrom }) }));

import { run } from '../api/cron/check-feedback';

const DUE_PREDICTION = {
  id: 'p1',
  theme_id: 't1',
  created_at: '2026-07-20T00:00:00Z',
  range_low: -4,
  range_high: -2,
  check_after_days: 3,
};

const PRICE_ROWS = [
  { stock_id: 's1', date: '2026-07-20', close_price: 100 },
  { stock_id: 's1', date: '2026-07-23', close_price: 97 },
];

function mockPredictionsAndPriceTables(update: ReturnType<typeof vi.fn>) {
  return (table: string) => {
    if (table === 'predictions') {
      return {
        select: () => ({
          eq: () => ({
            lte: () => Promise.resolve({ data: [DUE_PREDICTION], error: null }),
          }),
        }),
        update,
      };
    }
    if (table === 'stock_themes') {
      return { select: () => ({ eq: () => Promise.resolve({ data: [{ stock_id: 's1' }], error: null }) }) };
    }
    if (table === 'price_history') {
      return {
        select: () => ({
          in: () => ({
            gte: () => ({
              lte: () => ({
                order: () => Promise.resolve({ data: PRICE_ROWS, error: null }),
              }),
            }),
          }),
        }),
      };
    }
    return null; // caller fills in prediction_feedback
  };
}

describe('check-feedback run()', () => {
  it('compares a due prediction against actual price history and records feedback', async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));
    const base = mockPredictionsAndPriceTables(update);

    mockFrom.mockImplementation((table: string) => {
      if (table === 'prediction_feedback') return { upsert };
      return base(table) ?? {};
    });

    const result = await run();

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        prediction_id: 'p1',
        actual_change_pct: -3,
      }),
      { onConflict: 'prediction_id' },
    );
    expect(result.checked).toBe(1);
  });

  it('recovers on retry after the checked-update failed following a successful feedback upsert, without a duplicate-key error', async () => {
    const upsert = vi.fn(async () => ({ error: null }));
    // First run: the checked=true update fails (e.g. transient network error).
    // Second run (retry): it succeeds.
    const update = vi
      .fn()
      .mockReturnValueOnce({ eq: () => Promise.resolve({ error: { message: 'network blip' } }) })
      .mockReturnValueOnce({ eq: () => Promise.resolve({ error: null }) });
    const base = mockPredictionsAndPriceTables(update);

    mockFrom.mockImplementation((table: string) => {
      if (table === 'prediction_feedback') return { upsert };
      return base(table) ?? {};
    });

    const firstRun = await run();
    expect(firstRun.checked).toBe(0);
    expect(firstRun.failures).toEqual(['p1: predictions update failed: network blip']);
    expect(upsert).toHaveBeenCalledTimes(1);

    // Retry: prediction is still checked=false in the DB (the mock re-serves the same
    // row), so run() reprocesses it. Because prediction_feedback.upsert (not insert) is
    // used, re-submitting the same feedback row does not raise a 23505 duplicate-key
    // error even though a row for prediction_id already exists from the first attempt.
    const secondRun = await run();
    expect(secondRun.checked).toBe(1);
    expect(secondRun.failures).toEqual([]);
    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ prediction_id: 'p1', actual_change_pct: -3 }),
      { onConflict: 'prediction_id' },
    );
  });
});
