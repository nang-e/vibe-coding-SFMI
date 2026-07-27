import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../lib/supabaseClient';
import { fetchThemeReactionHistory, computeThemeReactionStats } from '../../lib/stats';
import { buildPredictionDraft } from '../../lib/predict';
import { requireCronSecret } from '../../lib/auth';

const CHECK_AFTER_DAYS = 3;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCronSecret(req)) return res.status(401).json({ error: 'unauthorized' });

  const supabase = getSupabase();
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // last hour of tags
  const { data: recentTags, error } = await supabase
    .from('news_tags')
    .select('theme_id, sentiment, reasoning, themes(name), news_items(title)')
    .neq('sentiment', 'neutral')
    .gte('created_at', since);
  if (error) return res.status(500).json({ error: error.message });

  const byTheme = new Map<string, { name: string; sentiment: string; summaries: string[] }>();
  for (const tag of recentTags ?? []) {
    const themeName = (tag as any).themes?.name ?? 'unknown';
    const key = `${tag.theme_id}:${tag.sentiment}`;
    if (!byTheme.has(key)) byTheme.set(key, { name: themeName, sentiment: tag.sentiment, summaries: [] });
    byTheme.get(key)!.summaries.push((tag as any).news_items?.title ?? tag.reasoning);
  }

  const results = { created: 0, failures: [] as string[] };
  for (const [key, group] of byTheme) {
    const [themeId] = key.split(':');
    try {
      const history = await fetchThemeReactionHistory(themeId, group.sentiment as 'positive' | 'negative');
      const stats = computeThemeReactionStats(history);
      const draft = await buildPredictionDraft({ themeName: group.name, recentNewsSummaries: group.summaries, stats });
      const { error: insertError } = await supabase.from('predictions').insert({
        theme_id: themeId,
        direction: draft.direction,
        range_low: draft.rangeLow,
        range_high: draft.rangeHigh,
        confidence: draft.confidence,
        reasoning: draft.reasoning,
        check_after_days: CHECK_AFTER_DAYS,
      });
      if (insertError) throw new Error(`prediction insert failed: ${insertError.message}`);
      results.created++;
    } catch (err) {
      results.failures.push(`${key}: ${(err as Error).message}`);
    }
  }

  return res.status(200).json(results);
}
