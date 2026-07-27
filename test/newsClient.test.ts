import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchNaverNews, fetchRssFeed } from '../lib/newsClient';

const naverResponse = {
  items: [
    {
      title: 'SK하이닉스, D램 수요 증가 전망',
      originallink: 'https://example.com/a',
      link: 'https://news.naver.com/a',
      description: 'D램 수요가 늘어날 것으로 전망된다.',
      pubDate: 'Mon, 27 Jul 2026 09:00:00 +0900',
    },
  ],
};

const rssXml = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title>Bird flu spreads across farms</title>
    <link>https://bbc.com/b</link>
    <description>Avian flu outbreak reported.</description>
    <pubDate>Mon, 27 Jul 2026 06:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

beforeEach(() => {
  process.env.NAVER_CLIENT_ID = 'id';
  process.env.NAVER_CLIENT_SECRET = 'secret';
});

describe('fetchNaverNews', () => {
  it('maps Naver API items into RawNewsItem', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => naverResponse })));
    const items = await fetchNaverNews('SK하이닉스');
    expect(items).toEqual([
      {
        source: 'naver',
        url: 'https://news.naver.com/a',
        title: 'SK하이닉스, D램 수요 증가 전망',
        summary: 'D램 수요가 늘어날 것으로 전망된다.',
        publishedAt: new Date('Mon, 27 Jul 2026 09:00:00 +0900').toISOString(),
      },
    ]);
  });
});

describe('fetchRssFeed', () => {
  it('parses RSS items into RawNewsItem', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => rssXml })));
    const items = await fetchRssFeed('https://feeds.bbci.co.uk/news/business/rss.xml', 'bbc');
    expect(items).toEqual([
      {
        source: 'bbc',
        url: 'https://bbc.com/b',
        title: 'Bird flu spreads across farms',
        summary: 'Avian flu outbreak reported.',
        publishedAt: new Date('Mon, 27 Jul 2026 06:00:00 GMT').toISOString(),
      },
    ]);
  });
});
