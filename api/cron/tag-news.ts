import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiError } from '@google/genai';
import { getSupabase } from '../../lib/supabaseClient';
import { tagNewsItem } from '../../lib/tagNews';
import { requireCronSecret } from '../../lib/auth';
import type { Theme } from '../../lib/types';

// Gemini free tier caps (TAGGING_MODEL, lite tier): ~15 requests/minute, ~1000 requests/day.
// Cap each run's batch well under the per-minute limit so a single invocation can't
// blow through it, leaving any remaining backlog for the next scheduled run.
const MAX_PER_RUN = 20;

function isRateLimitError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 429;
}

export async function run() {
  const supabase = getSupabase();
  const { data: themes, error: themesError } = await supabase.from('themes').select('*');
  if (themesError) throw new Error(themesError.message);

  const { data: taggedNewsIds, error: taggedError } = await supabase.from('news_tags').select('news_item_id');
  if (taggedError) throw new Error(taggedError.message);
  const taggedIds = new Set((taggedNewsIds ?? []).map((r) => r.news_item_id));

  const { data: allNews, error: newsError } = await supabase
    .from('news_items')
    .select('*')
    .order('collected_at', { ascending: false })
    .limit(200);
  if (newsError) throw new Error(newsError.message);

  const untagged = (allNews ?? []).filter((n) => !taggedIds.has(n.id)).slice(0, MAX_PER_RUN);
  const results = { tagged: 0, noThemeFound: 0, failures: [] as string[] };

  for (let i = 0; i < untagged.length; i++) {
    const news = untagged[i];
    try {
      const tags = await tagNewsItem({ title: news.title, summary: news.summary }, themes as Theme[]);
      if (tags.length === 0) {
        results.noThemeFound++;
        continue;
      }
      for (const tag of tags) {
        const theme = (themes as Theme[]).find((t) => t.name === tag.themeName);
        if (!theme) continue;
        const { error: insertError } = await supabase.from('news_tags').insert({
          news_item_id: news.id,
          theme_id: theme.id,
          sentiment: tag.sentiment,
          confidence: tag.confidence,
          reasoning: tag.reasoning,
        });
        if (insertError) {
          results.failures.push(`${news.id}/theme:${theme.id}: ${insertError.message}`);
        }
      }
      results.tagged++;
    } catch (err) {
      if (isRateLimitError(err)) {
        results.failures.push(`rate limited, stopping early after ${i} items`);
        break;
      }
      results.failures.push(`${news.id}: ${(err as Error).message}`);
    }
  }

  return results;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCronSecret(req)) return res.status(401).json({ error: 'unauthorized' });

  try {
    const result = await run();
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
