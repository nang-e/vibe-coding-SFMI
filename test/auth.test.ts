import { describe, it, expect } from 'vitest';
import { requireCronSecret } from '../lib/auth';

describe('requireCronSecret', () => {
  it('rejects a request with the wrong secret', () => {
    process.env.CRON_SECRET = 'correct-secret';
    const req = { headers: { 'x-cron-secret': 'wrong' } } as any;
    expect(requireCronSecret(req)).toBe(false);
  });

  it('accepts a request with the correct secret', () => {
    process.env.CRON_SECRET = 'correct-secret';
    const req = { headers: { 'x-cron-secret': 'correct-secret' } } as any;
    expect(requireCronSecret(req)).toBe(true);
  });

  it('accepts a request with the correct secret via Authorization: Bearer (native Vercel Cron)', () => {
    process.env.CRON_SECRET = 'correct-secret';
    const req = { headers: { authorization: 'Bearer correct-secret' } } as any;
    expect(requireCronSecret(req)).toBe(true);
  });

  it('rejects a request with the wrong Authorization: Bearer secret', () => {
    process.env.CRON_SECRET = 'correct-secret';
    const req = { headers: { authorization: 'Bearer wrong' } } as any;
    expect(requireCronSecret(req)).toBe(false);
  });

  it('rejects when neither header is present', () => {
    process.env.CRON_SECRET = 'correct-secret';
    const req = { headers: {} } as any;
    expect(requireCronSecret(req)).toBe(false);
  });
});
