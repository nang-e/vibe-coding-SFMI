import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCronSecret } from '../../lib/auth';
import { run as collectPrices } from './collect-prices';
import { run as collectNews } from './collect-news';
import { run as tagNews } from './tag-news';
import { run as generatePredictions } from './generate-predictions';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCronSecret(req)) return res.status(401).json({ error: 'unauthorized' });

  const prices = await collectPrices();
  const news = await collectNews();
  const tagging = await tagNews();
  const predictions = await generatePredictions();

  return res.status(200).json({ prices, news, tagging, predictions });
}
