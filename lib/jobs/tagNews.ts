import { getSupabase } from '../supabaseClient';
import { tagNewsItem } from '../tagNews';
import { OpenRouterError } from '../openrouterClient';
import type { Theme } from '../types';

// OpenRouter free-tier models: 20 requests/minute, 50 requests/day account-wide.
// Cap each run's batch well under the per-minute limit so a single invocation can't
// blow through it, leaving any remaining backlog for the next scheduled run.
const MAX_PER_RUN = 20;

function isRateLimitError(err: unknown): boolean {
  return err instanceof OpenRouterError && err.status === 429;
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
