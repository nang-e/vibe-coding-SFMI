import type { VercelRequest, VercelResponse } from '@vercel/node';
import { waitUntil } from '@vercel/functions';
import { requireCronSecret } from '../../lib/auth';
import { run as collectPrices } from './collect-prices';
import { run as collectNews } from './collect-news';
import { run as tagNews } from './tag-news';
import { run as generatePredictions } from './generate-predictions';

// The full chain (price/news collection + Gemini tagging/predictions) can run
// well past external cron callers' short request timeouts (e.g. cron-job.org).
// Ack immediately and let the work continue via waitUntil, same pattern as the
// Kakao webhook — the caller only needs the run to have been triggered, not to
// wait for it to finish.
//
// waitUntil only keeps the invocation alive up to the function's own
// maxDuration — without raising it past the platform default (10s), the
// background chain (price fetches + up to 20 sequential Gemini tag calls +
// prediction generation) gets killed mid-run with no error logged, which is
// why scheduled runs silently produced no Kakao message. 60s is the Hobby
// plan's configurable ceiling.
export const config = {
  maxDuration: 60,
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCronSecret(req)) return res.status(401).json({ error: 'unauthorized' });

  res.status(202).json({ status: 'started' });

  waitUntil(
    (async () => {
      const prices = await collectPrices();
      const news = await collectNews();
      const tagging = await tagNews();
      const predictions = await generatePredictions();
      console.log('pipeline run finished', { prices, news, tagging, predictions });
    })().catch((err) => {
      console.error('pipeline background failure:', err);
    }),
  );
}
