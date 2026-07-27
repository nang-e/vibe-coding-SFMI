import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../lib/supabaseClient';
import { requireCronSecret } from '../../lib/auth';

export async function run(): Promise<{ checked: number; failures: string[] }> {
  const supabase = getSupabase();
  const results = { checked: 0, failures: [] as string[] };

  const cutoff = new Date().toISOString();
  const { data: due, error } = await supabase
    .from('predictions')
    .select('*')
    .eq('checked', false)
    .lte('created_at', cutoff);
  if (error) throw new Error(error.message);

  for (const prediction of due ?? []) {
    try {
      const createdAt = new Date(prediction.created_at);
      const dueDate = new Date(createdAt.getTime() + prediction.check_after_days * 24 * 60 * 60 * 1000);
      if (dueDate > new Date()) continue; // not due yet

      const { data: stockLinks, error: stockLinksError } = await supabase
        .from('stock_themes')
        .select('stock_id')
        .eq('theme_id', prediction.theme_id);
      if (stockLinksError) throw new Error(`stock_themes lookup failed: ${stockLinksError.message}`);

      const stockIds = (stockLinks ?? []).map((r) => r.stock_id);
      if (stockIds.length === 0) continue;

      const { data: prices, error: pricesError } = await supabase
        .from('price_history')
        .select('stock_id, date, close_price')
        .in('stock_id', stockIds)
        .gte('date', createdAt.toISOString().slice(0, 10))
        .lte('date', dueDate.toISOString().slice(0, 10))
        .order('date', { ascending: true });
      if (pricesError) throw new Error(`price_history lookup failed: ${pricesError.message}`);

      if (!prices || prices.length < 2) continue;
      const first = prices[0].close_price;
      const last = prices[prices.length - 1].close_price;
      const actualChangePct = ((last - first) / first) * 100;

      const withinRange = actualChangePct >= prediction.range_low && actualChangePct <= prediction.range_high;
      const accuracyNote = withinRange
        ? '예상 범위 내로 적중'
        : `예상 범위(${prediction.range_low}~${prediction.range_high}%)를 벗어남`;

      const { error: insertError } = await supabase.from('prediction_feedback').insert({
        prediction_id: prediction.id,
        actual_change_pct: actualChangePct,
        accuracy_note: accuracyNote,
      });
      if (insertError) throw new Error(`prediction_feedback insert failed: ${insertError.message}`);

      const { error: updateError } = await supabase
        .from('predictions')
        .update({ checked: true })
        .eq('id', prediction.id);
      if (updateError) throw new Error(`predictions update failed: ${updateError.message}`);

      results.checked++;
    } catch (err) {
      results.failures.push(`${prediction.id}: ${(err as Error).message}`);
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
