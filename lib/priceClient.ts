const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart';

interface ChartResult {
  meta: { regularMarketPrice: number; chartPreviousClose: number };
  timestamp: number[];
  indicators: { quote: [{ close: (number | null)[] }] };
}

async function fetchChart(ticker: string, interval: string, range: string): Promise<ChartResult> {
  const url = `${YAHOO_CHART_URL}/${ticker}?interval=${interval}&range=${range}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yahoo chart request failed: ${res.status}`);
  const body = await res.json();
  const result = body.chart?.result?.[0];
  if (!result) throw new Error(`No chart data for ticker ${ticker}`);
  return result;
}

export async function fetchDailyCloses(ticker: string, days: number): Promise<{ date: string; close: number }[]> {
  const range = days <= 30 ? '1mo' : days <= 90 ? '3mo' : '1y';
  const result = await fetchChart(ticker, '1d', range);
  const closes = result.indicators.quote[0].close;
  return result.timestamp
    .map((ts, i) => ({ date: new Date(ts * 1000).toISOString().slice(0, 10), close: closes[i] }))
    .filter((row): row is { date: string; close: number } => row.close !== null)
    .slice(-days);
}

export async function fetchLatestQuote(ticker: string): Promise<{ price: number; changePct: number }> {
  const result = await fetchChart(ticker, '1d', '5d');
  const { regularMarketPrice, chartPreviousClose } = result.meta;
  // meta.chartPreviousClose is tied to the requested range's *start*, not necessarily
  // yesterday's close (with range=5d it can be the close from ~6 sessions ago) — that
  // produced implausible multi-day swings mislabeled as today's change_pct. Prefer the
  // second-to-last close from the actual daily series; only fall back to the meta field
  // if fewer than two closes came back.
  const closes = result.indicators.quote[0].close.filter((c): c is number => c !== null);
  const prevClose = closes.length >= 2 ? closes[closes.length - 2] : chartPreviousClose;
  const changePct = ((regularMarketPrice - prevClose) / prevClose) * 100;
  return { price: regularMarketPrice, changePct };
}
