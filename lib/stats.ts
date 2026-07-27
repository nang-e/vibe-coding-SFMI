import { getSupabase } from './supabaseClient';

export interface ThemeReactionInput {
  changePctAfter: number;
}

export interface ThemeReactionStats {
  sampleSize: number;
  avgChangePct: number | null;
  minChangePct: number | null;
  maxChangePct: number | null;
  lowSample: boolean;
}

const LOW_SAMPLE_THRESHOLD = 3;
const REACTION_WINDOW_DAYS = 3;

export function computeThemeReactionStats(rows: ThemeReactionInput[]): ThemeReactionStats {
  if (rows.length === 0) {
    return { sampleSize: 0, avgChangePct: null, minChangePct: null, maxChangePct: null, lowSample: true };
  }
  const changes = rows.map((r) => r.changePctAfter);
  const avg = changes.reduce((sum, c) => sum + c, 0) / changes.length;
  return {
    sampleSize: changes.length,
    avgChangePct: avg,
    minChangePct: Math.min(...changes),
    maxChangePct: Math.max(...changes),
    lowSample: changes.length < LOW_SAMPLE_THRESHOLD,
  };
}

export async function fetchThemeReactionHistory(
  themeId: string,
  sentiment: 'positive' | 'negative',
): Promise<ThemeReactionInput[]> {
  const supabase = getSupabase();
  const { data: pastTags, error: pastTagsError } = await supabase
    .from('news_tags')
    .select('id, created_at')
    .eq('theme_id', themeId)
    .eq('sentiment', sentiment);
  if (pastTagsError) throw new Error(pastTagsError.message);

  const { data: stockLinks, error: stockLinksError } = await supabase
    .from('stock_themes')
    .select('stock_id')
    .eq('theme_id', themeId);
  if (stockLinksError) throw new Error(stockLinksError.message);

  const stockIds = (stockLinks ?? []).map((r) => r.stock_id);
  if (stockIds.length === 0 || !pastTags) return [];

  const results: ThemeReactionInput[] = [];
  for (const tag of pastTags) {
    const tagDate = new Date(tag.created_at);
    const afterDate = new Date(tagDate.getTime() + REACTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const { data: prices, error: pricesError } = await supabase
      .from('price_history')
      .select('stock_id, date, close_price')
      .in('stock_id', stockIds)
      .gte('date', tagDate.toISOString().slice(0, 10))
      .lte('date', afterDate.toISOString().slice(0, 10))
      .order('date', { ascending: true });
    if (pricesError) throw new Error(pricesError.message);
    if (!prices || prices.length < 2) continue;

    const byStock = new Map<string, typeof prices>();
    for (const p of prices) {
      if (!byStock.has(p.stock_id)) byStock.set(p.stock_id, []);
      byStock.get(p.stock_id)!.push(p);
    }
    for (const rows of byStock.values()) {
      if (rows.length < 2) continue;
      const first = rows[0].close_price;
      const last = rows[rows.length - 1].close_price;
      results.push({ changePctAfter: ((last - first) / first) * 100 });
    }
  }
  return results;
}
