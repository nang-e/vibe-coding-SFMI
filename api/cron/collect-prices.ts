import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../lib/supabaseClient';
import { fetchDailyCloses, fetchLatestQuote } from '../../lib/priceClient';
import { requireCronSecret } from '../../lib/auth';
import type { Stock } from '../../lib/types';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCronSecret(req)) return res.status(401).json({ error: 'unauthorized' });

  const supabase = getSupabase();
  const { data: stocks, error } = await supabase.from('stocks').select('*');
  if (error) return res.status(500).json({ error: error.message });

  const results = { updatedDaily: 0, updatedIntraday: 0, failures: [] as string[] };

  for (const stock of stocks as Stock[]) {
    try {
      const quote = await fetchLatestQuote(stock.ticker);
      const { error: intradayError } = await supabase.from('intraday_quotes').insert({
        stock_id: stock.id,
        price: quote.price,
        change_pct: quote.changePct,
      });
      if (intradayError) throw new Error(`intraday insert failed: ${intradayError.message}`);
      results.updatedIntraday++;

      const closes = await fetchDailyCloses(stock.ticker, 6);
      for (let i = 1; i < closes.length; i++) {
        const changePct = ((closes[i].close - closes[i - 1].close) / closes[i - 1].close) * 100;
        const { error: upsertError } = await supabase.from('price_history').upsert(
          { stock_id: stock.id, date: closes[i].date, close_price: closes[i].close, change_pct: changePct },
          { onConflict: 'stock_id,date' },
        );
        if (upsertError) throw new Error(`price_history upsert failed for ${closes[i].date}: ${upsertError.message}`);
      }
      results.updatedDaily++;
    } catch (err) {
      results.failures.push(`${stock.ticker}: ${(err as Error).message}`);
    }
  }

  return res.status(200).json(results);
}
