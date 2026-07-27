export interface Stock {
  id: string;
  ticker: string;
  name: string;
  market: 'KOSPI' | 'KOSDAQ';
  market_cap_rank: number | null;
}

export interface Theme {
  id: string;
  name: string;
}

export interface NewsItem {
  id: string;
  source: string;
  url: string;
  title: string;
  summary: string | null;
  published_at: string;
  collected_at: string;
}

export interface NewsTag {
  id: string;
  news_item_id: string;
  theme_id: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  confidence: number;
  reasoning: string;
}

export interface PriceHistoryRow {
  id: string;
  stock_id: string;
  date: string;
  close_price: number;
  change_pct: number | null;
}

export interface IntradayQuote {
  id: string;
  stock_id: string;
  captured_at: string;
  price: number;
  change_pct: number | null;
}

export interface Prediction {
  id: string;
  created_at: string;
  theme_id: string;
  stock_id: string | null;
  direction: 'up' | 'down';
  range_low: number;
  range_high: number;
  confidence: number;
  reasoning: string;
  check_after_days: number;
  checked: boolean;
}

export interface PredictionFeedback {
  id: string;
  prediction_id: string;
  actual_change_pct: number;
  accuracy_note: string;
  checked_at: string;
}
