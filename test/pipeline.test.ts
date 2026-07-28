import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../api/cron/collect-prices', () => ({ run: vi.fn(async () => ({ updatedDaily: 1 })) }));
vi.mock('../api/cron/collect-news', () => ({ run: vi.fn(async () => ({ inserted: 2 })) }));
vi.mock('../api/cron/tag-news', () => ({ run: vi.fn(async () => ({ tagged: 1 })) }));
vi.mock('../api/cron/generate-predictions', () => ({ run: vi.fn(async () => ({ created: 1 })) }));

const capturedBackgroundPromises: Promise<any>[] = [];
vi.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<any>) => { capturedBackgroundPromises.push(p); },
}));

import handler from '../api/cron/pipeline';
import { run as collectPrices } from '../api/cron/collect-prices';
import { run as collectNews } from '../api/cron/collect-news';
import { run as tagNews } from '../api/cron/tag-news';
import { run as generatePredictions } from '../api/cron/generate-predictions';

describe('pipeline handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedBackgroundPromises.length = 0;
  });

  it('acknowledges immediately, then runs all four steps in order via waitUntil', async () => {
    process.env.CRON_SECRET = 'secret';
    const req = { headers: { 'x-cron-secret': 'secret' } } as any;
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) } as any;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(202);
    expect(json).toHaveBeenCalledWith({ status: 'started' });

    await Promise.all(capturedBackgroundPromises);

    expect(collectPrices).toHaveBeenCalled();
    expect(collectNews).toHaveBeenCalled();
    expect(tagNews).toHaveBeenCalled();
    expect(generatePredictions).toHaveBeenCalled();
  });

  it('returns 401 and does not run any steps when the cron secret is missing or wrong', async () => {
    process.env.CRON_SECRET = 'secret';
    const req = { headers: { 'x-cron-secret': 'wrong' } } as any;
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) } as any;

    await handler(req, res);

    expect(collectPrices).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
