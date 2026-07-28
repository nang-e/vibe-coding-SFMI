import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCronSecret } from '../../lib/auth';
import { run } from '../../lib/jobs/generatePredictions';

export { run };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCronSecret(req)) return res.status(401).json({ error: 'unauthorized' });

  try {
    const result = await run();
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
