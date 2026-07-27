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
  const changePct = ((regularMarketPrice - chartPreviousClose) / chartPreviousClose) * 100;
  return { price: regularMarketPrice, changePct };
}
