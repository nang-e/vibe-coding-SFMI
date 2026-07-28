import { getSupabase } from '../supabaseClient';
import { fetchNaverNews, fetchRssFeed } from '../newsClient';

const NAVER_QUERIES = [
  '반도체', '2차전지', '바이오', '자동차 산업', '조선업', '축산업', '금리',
  '삼성전자', 'SK하이닉스', '엔비디아', 'TSMC', 'ASML', '반도체 수출', '반도체 업황',
];
const RSS_FEEDS = [
  { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', source: 'bbc' },
  { url: 'https://www.marketwatch.com/rss/topstories', source: 'marketwatch' },
];

export async function run() {
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

  return results;
}
