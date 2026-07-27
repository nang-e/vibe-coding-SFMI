import Parser from 'rss-parser';

export interface RawNewsItem {
  source: string;
  url: string;
  title: string;
  summary: string | null;
  publishedAt: string;
}

export async function fetchNaverNews(query: string): Promise<RawNewsItem[]> {
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=50&sort=date`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID!,
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET!,
    },
  });
  if (!res.ok) throw new Error(`Naver News API request failed: ${res.status}`);
  const body = await res.json();
  return body.items.map((item: any) => ({
    source: 'naver',
    url: item.link,
    title: stripHtml(item.title),
    summary: item.description ? stripHtml(item.description) : null,
    publishedAt: new Date(item.pubDate).toISOString(),
  }));
}

export async function fetchRssFeed(url: string, source: string): Promise<RawNewsItem[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`RSS fetch failed for ${source}: ${res.status}`);
  const xml = await res.text();
  const parser = new Parser();
  const feed = await parser.parseString(xml);
  return (feed.items ?? []).map((item) => ({
    source,
    url: item.link ?? '',
    title: item.title ?? '',
    summary: item.contentSnippet ?? item.content ?? null,
    publishedAt: new Date(item.pubDate ?? item.isoDate ?? Date.now()).toISOString(),
  }));
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, '');
}
