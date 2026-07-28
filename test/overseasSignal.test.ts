import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/priceClient', () => ({
  fetchLatestQuote: vi.fn(async (ticker: string) => {
    if (ticker === 'FAIL') throw new Error('boom');
    return { price: 100, changePct: ticker === 'NVDA' ? -3.2 : 1.5 };
  }),
}));

import { fetchOverseasSignals } from '../lib/overseasSignal';

describe('fetchOverseasSignals', () => {
  it('returns changePct per peer', async () => {
    const result = await fetchOverseasSignals([
      { ticker: 'NVDA', name: '엔비디아' },
      { ticker: 'ASML', name: 'ASML' },
    ]);
    expect(result).toEqual([
      { ticker: 'NVDA', name: '엔비디아', changePct: -3.2 },
      { ticker: 'ASML', name: 'ASML', changePct: 1.5 },
    ]);
  });

  it('omits a peer whose fetch fails instead of throwing', async () => {
    const result = await fetchOverseasSignals([
      { ticker: 'NVDA', name: '엔비디아' },
      { ticker: 'FAIL', name: 'Broken' },
    ]);
    expect(result).toEqual([{ ticker: 'NVDA', name: '엔비디아', changePct: -3.2 }]);
  });
});
