import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../lib/supabaseClient';
import { fetchNaverNews, fetchRssFeed } from '../../lib/newsClient';
import { requireCronSecret } from '../../lib/auth';

const NAVER_QUERIES = ['반도체', '2차전지', '바이오', '자동차 산업', '조선업', '축산업', '금리'];
const RSS_FEEDS = [
  { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', source: 'bbc' },
  { url: 'https://www.marketwatch.com/rss/topstories', source: 'marketwatch' },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCronSecret(req)) return res.status(401).json({ error: 'unauthorized' });

  const supabase = getSupabase();
  const results = { inserted: 0, skipped: 0, failures: [] as string[] };

  const batches = await Promise.all([
    ...NAVER_QUERIES.map((q) => fetchNaverNews(q).catch((e) => { results.failures.push(`naver:${q}: ${e.message}`); return []; })),
    ...RSS_FEEDS.map((f) => fetchRssFeed(f.url, f.source).catch((e) => { results.failures.push(`${f.source}: ${e.message}`); return []; })),
  ]);

  for (const item of batches.flat()) {
    if (!item.url || !item.title) continue;
    const { error } = await supabase.from('news_items').insert({
      source: item.source,
      url: item.url,
      title: item.title,
      summary: item.summary,
      published_at: item.publishedAt,
    });
    if (error) {
      if (error.code === '23505') results.skipped++; // duplicate url, already collected
      else results.failures.push(`${item.url}: ${error.message}`);
    } else {
      results.inserted++;
    }
  }

  return res.status(200).json(results);
}
