import type { VercelRequest } from '@vercel/node';

export function requireCronSecret(req: VercelRequest): boolean {
  const provided = req.headers['x-cron-secret'];
  return typeof provided === 'string' && provided === process.env.CRON_SECRET && provided.length > 0;
}
