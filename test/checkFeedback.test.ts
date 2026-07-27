import { describe, it, expect, vi } from 'vitest';

const mockFrom = vi.fn();
vi.mock('../lib/supabaseClient', () => ({ getSupabase: () => ({ from: mockFrom }) }));

import { run } from '../api/cron/check-feedback';

describe('check-feedback run()', () => {
  it('compares a due prediction against actual price history and records feedback', async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));

    mockFrom.mockImplementation((table: string) => {
      if (table === 'predictions') {
        return {
          select: () => ({
            eq: () => ({
              lte: () => Promise.resolve({
                data: [{ id: 'p1', theme_id: 't1', created_at: '2026-07-20T00:00:00Z', range_low: -4, range_high: -2, check_after_days: 3 }],
                error: null,
              }),
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
                  order: () => Promise.resolve({
                    data: [
                      { stock_id: 's1', date: '2026-07-20', close_price: 100 },
                      { stock_id: 's1', date: '2026-07-23', close_price: 97 },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'prediction_feedback') return { insert };
      return {};
    });

    const result = await run();

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      prediction_id: 'p1',
      actual_change_pct: -3,
    }));
    expect(result.checked).toBe(1);
  });
});
