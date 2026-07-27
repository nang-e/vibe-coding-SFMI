import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../lib/supabaseClient';
import { tagNewsItem } from '../../lib/tagNews';
import { requireCronSecret } from '../../lib/auth';
import type { Theme } from '../../lib/types';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCronSecret(req)) return res.status(401).json({ error: 'unauthorized' });

  const supabase = getSupabase();
  const { data: themes, error: themesError } = await supabase.from('themes').select('*');
  if (themesError) return res.status(500).json({ error: themesError.message });

  const { data: taggedNewsIds, error: taggedError } = await supabase.from('news_tags').select('news_item_id');
  if (taggedError) return res.status(500).json({ error: taggedError.message });
  const taggedIds = new Set((taggedNewsIds ?? []).map((r) => r.news_item_id));

  const { data: allNews, error: newsError } = await supabase
    .from('news_items')
    .select('*')
    .order('collected_at', { ascending: false })
    .limit(200);
  if (newsError) return res.status(500).json({ error: newsError.message });

  const untagged = (allNews ?? []).filter((n) => !taggedIds.has(n.id));
  const results = { tagged: 0, noThemeFound: 0, failures: [] as string[] };

  for (const news of untagged) {
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
      results.failures.push(`${news.id}: ${(err as Error).message}`);
    }
  }

  return res.status(200).json(results);
}
