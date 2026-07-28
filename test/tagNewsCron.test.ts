import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFrom = vi.fn();
vi.mock('../lib/supabaseClient', () => ({ getSupabase: () => ({ from: mockFrom }) }));

const mockTagNewsItem = vi.fn();
vi.mock('../lib/tagNews', () => ({ tagNewsItem: (...args: any[]) => mockTagNewsItem(...args) }));

import { ApiError } from '@google/genai';
import { run } from '../api/cron/tag-news';

const THEMES = [{ id: 'th1', name: '반도체' }];

function makeNewsItems(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `n${i}`, title: `title ${i}`, summary: null }));
}

function baseFrom(newsItems: any[], insertMock: ReturnType<typeof vi.fn>) {
  return (table: string) => {
    if (table === 'themes') {
      return { select: () => Promise.resolve({ data: THEMES, error: null }) };
    }
    if (table === 'news_tags') {
      return {
        select: () => Promise.resolve({ data: [], error: null }), // nothing tagged yet
        insert: insertMock,
      };
    }
    if (table === 'news_items') {
      return {
        select: () => ({
          order: () => ({
            limit: () => Promise.resolve({ data: newsItems, error: null }),
          }),
        }),
      };
    }
    return { select: () => Promise.resolve({ data: [], error: null }) };
  };
}

describe('tag-news run()', () => {
  beforeEach(() => {
    mockTagNewsItem.mockReset();
  });

  it('caps the number of items processed per run even when more are untagged (Gemini free-tier RPM guard)', async () => {
    const newsItems = makeNewsItems(25); // more than the MAX_PER_RUN cap of 20
    const insertMock = vi.fn(async () => ({ error: null }));
    mockFrom.mockImplementation(baseFrom(newsItems, insertMock));
    mockTagNewsItem.mockResolvedValue([]); // no theme matched

    const result = await run();

    expect(mockTagNewsItem).toHaveBeenCalledTimes(20);
    expect(result.noThemeFound).toBe(20);
  });

  it('stops early on the first rate-limit (429) error instead of burning further doomed calls', async () => {
    const newsItems = makeNewsItems(5);
    const insertMock = vi.fn(async () => ({ error: null }));
    mockFrom.mockImplementation(baseFrom(newsItems, insertMock));

    mockTagNewsItem
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new ApiError({ message: 'rate limited', status: 429 }));

    const result = await run();

    expect(mockTagNewsItem).toHaveBeenCalledTimes(3);
    expect(result.failures).toEqual(['rate limited, stopping early after 2 items']);
  });
});
