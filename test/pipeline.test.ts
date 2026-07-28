import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/jobs/collectPrices', () => ({ run: vi.fn(async () => ({ updatedDaily: 1 })) }));
vi.mock('../lib/jobs/collectNews', () => ({ run: vi.fn(async () => ({ inserted: 2 })) }));
vi.mock('../lib/jobs/tagNews', () => ({ run: vi.fn(async () => ({ tagged: 1 })) }));
vi.mock('../lib/jobs/generatePredictions', () => ({ run: vi.fn(async () => ({ created: 1 })) }));

const capturedBackgroundPromises: Promise<any>[] = [];
vi.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<any>) => { capturedBackgroundPromises.push(p); },
}));

import handler from '../api/cron/pipeline';
import { run as collectPrices } from '../lib/jobs/collectPrices';
import { run as collectNews } from '../lib/jobs/collectNews';
import { run as tagNews } from '../lib/jobs/tagNews';
import { run as generatePredictions } from '../lib/jobs/generatePredictions';

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
