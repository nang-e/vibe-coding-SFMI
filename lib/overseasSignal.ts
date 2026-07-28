import { fetchLatestQuote } from './priceClient';

export interface OverseasPeer {
  ticker: string;
  name: string;
}

export interface OverseasSignal extends OverseasPeer {
  changePct: number;
}

// Maps a domestic theme name to overseas large-cap peers whose moves tend to
// lead the Korean theme by a market session (US market closes ~14 hours
// before KOSPI/KOSDAQ opens) — used as a leading-indicator signal even when
// no domestic news has been tagged yet.
export const THEME_OVERSEAS_PEERS: Record<string, OverseasPeer[]> = {
  반도체: [
    { ticker: 'ASML', name: 'ASML' },
    { ticker: 'NVDA', name: '엔비디아' },
    { ticker: 'TSM', name: 'TSMC' },
  ],
};

export async function fetchOverseasSignals(peers: OverseasPeer[]): Promise<OverseasSignal[]> {
  const signals: OverseasSignal[] = [];
  for (const peer of peers) {
    try {
      const quote = await fetchLatestQuote(peer.ticker);
      signals.push({ ...peer, changePct: quote.changePct });
    } catch {
      // A single peer's fetch failing (rate limit, delisting, etc.) shouldn't
      // block the rest — just omit it from the signal set.
    }
  }
  return signals;
}
