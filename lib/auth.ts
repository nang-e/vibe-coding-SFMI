import type { VercelRequest } from '@vercel/node';
import { timingSafeEqual } from 'crypto';

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// Accepts either:
// - `x-cron-secret: <secret>` — used by the external cron-job.org trigger for /api/cron/pipeline
// - `Authorization: Bearer <secret>` — sent automatically by Vercel's native Cron feature
//   (used for /api/cron/check-feedback via vercel.json) when CRON_SECRET is set on the project.
export function requireCronSecret(req: VercelRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const custom = req.headers['x-cron-secret'];
  if (typeof custom === 'string' && custom.length > 0 && safeEqual(custom, secret)) return true;

  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && safeEqual(authHeader, `Bearer ${secret}`)) return true;

  return false;
}
