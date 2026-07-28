import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCronSecret } from '../../lib/auth';
import { run } from '../../lib/jobs/collectNews';

export { run };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCronSecret(req)) return res.status(401).json({ error: 'unauthorized' });

  const result = await run();
  return res.status(200).json(result);
}
