# AI 주식 추천 비서 (카카오톡 연동) MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal-use backend that collects Korean/international financial news and Korean stock prices, uses Claude to tag news by theme/sentiment and generate historical-pattern-based predictions, answers questions via a KakaoTalk chatbot webhook, and checks its own prediction accuracy over time.

**Architecture:** A single TypeScript project deployed as Vercel Serverless Functions. A pipeline endpoint (triggered every 15–30 min by an external free cron service, since the Vercel account is on the Hobby plan) collects news + prices, tags news with Claude Haiku, and generates predictions with Claude Sonnet. A separate webhook endpoint answers KakaoTalk questions on demand. A daily Vercel Cron job checks past predictions against actual outcomes. Supabase (Postgres) is the single source of truth for all data.

**Tech Stack:** TypeScript, Vercel Serverless Functions (no frontend framework), Supabase (`@supabase/supabase-js`), Claude (`@anthropic-ai/sdk`), `rss-parser`, Vitest for tests, Yahoo Finance's public chart endpoint for prices (no account needed), Naver News Search API + BBC/MarketWatch RSS for news.

## Global Constraints

- Personal use only, single user — no auth/multi-tenant logic needed.
- Every KakaoTalk answer that includes a prediction MUST include the disclaimer: "투자 참고용이며 투자 판단과 책임은 본인에게 있습니다." (spec §1, §2)
- No secrets in code — all keys (Claude, Supabase, Naver, Kakao, cron shared secret) live in `.env` locally and Vercel env vars in production; `.env` is git-ignored (CLAUDE.md 보안 규칙).
- When historical sample size for a theme is small, the answer must say so explicitly instead of fabricating confidence (spec §6).
- Vercel account is Hobby (free) plan: native Vercel Cron may run **at most once per day** per cron entry. The 15–30 min collection pipeline therefore cannot use native Vercel Cron and must be triggered externally (cron-job.org) against a secret-protected endpoint. The once-daily feedback check CAN use native Vercel Cron.
- Kakao skill server webhooks must respond within 5 seconds or use the `useCallback` pattern (spec §5B, §6).
- Price data tier: 15–20 min delayed quotes + daily close history, no brokerage account (spec decision, 2026-07-27).

---

### Task 1: Project scaffolding, Supabase project, and schema

**Files:**
- Create: `package.json`, `tsconfig.json`, `.gitignore`, `.env.example`, `vitest.config.ts`
- Create: `lib/types.ts`
- Create: `supabase/migrations/0001_init_schema.sql`
- Create: `supabase/migrations/0002_seed_stocks_themes.sql`
- Test: `test/schema.test.ts`

**Interfaces:**
- Produces: all TypeScript types in `lib/types.ts` (`Stock`, `Theme`, `NewsItem`, `NewsTag`, `PriceHistoryRow`, `IntradayQuote`, `Prediction`, `PredictionFeedback`) — every later task imports from here.
- Produces: Supabase tables `stocks`, `themes`, `stock_themes`, `news_items`, `news_tags`, `price_history`, `intraday_quotes`, `predictions`, `prediction_feedback`, `kakao_conversations`.

- [ ] **Step 1: Create a new Supabase project via MCP**

Call the Supabase MCP `create_project` tool with:
- `name`: `ai-stock-kakao-assistant`
- `organization_id`: `erdpocqlvwzzhidaaymp` (org: vibe-coding-projects)
- `region`: `ap-northeast-2`

Confirm the returned project is `ACTIVE_HEALTHY` before continuing (Supabase projects take ~1-2 min to provision — poll `get_project` if needed).

- [ ] **Step 2: Initialize the npm project**

```bash
npm init -y
npm install @supabase/supabase-js @anthropic-ai/sdk @vercel/functions rss-parser dotenv
npm install -D typescript vitest @types/node @vercel/node tsx
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "types": ["node"]
  },
  "include": ["lib/**/*.ts", "api/**/*.ts"]
}
```

`.gitignore`:
```
node_modules/
dist/
.env
.vercel/
```

`.env.example`:
```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
NAVER_CLIENT_ID=
NAVER_CLIENT_SECRET=
CRON_SECRET=
```

`vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node' },
});
```

- [ ] **Step 3: Write the schema migration**

`supabase/migrations/0001_init_schema.sql`:
```sql
create table stocks (
  id uuid primary key default gen_random_uuid(),
  ticker text not null unique,
  name text not null,
  market text not null check (market in ('KOSPI', 'KOSDAQ')),
  market_cap_rank int
);

create table themes (
  id uuid primary key default gen_random_uuid(),
  name text not null unique
);

create table stock_themes (
  stock_id uuid not null references stocks(id) on delete cascade,
  theme_id uuid not null references themes(id) on delete cascade,
  primary key (stock_id, theme_id)
);

create table news_items (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  url text not null unique,
  title text not null,
  summary text,
  published_at timestamptz not null,
  collected_at timestamptz not null default now()
);

create table news_tags (
  id uuid primary key default gen_random_uuid(),
  news_item_id uuid not null references news_items(id) on delete cascade,
  theme_id uuid not null references themes(id) on delete cascade,
  sentiment text not null check (sentiment in ('positive', 'negative', 'neutral')),
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  reasoning text not null,
  created_at timestamptz not null default now()
);

create table price_history (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid not null references stocks(id) on delete cascade,
  date date not null,
  close_price numeric not null,
  change_pct numeric,
  unique (stock_id, date)
);

create table intraday_quotes (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid not null references stocks(id) on delete cascade,
  captured_at timestamptz not null default now(),
  price numeric not null,
  change_pct numeric
);

create table predictions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  theme_id uuid not null references themes(id) on delete cascade,
  stock_id uuid references stocks(id) on delete set null,
  direction text not null check (direction in ('up', 'down')),
  range_low numeric not null,
  range_high numeric not null,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  reasoning text not null,
  check_after_days int not null,
  checked boolean not null default false
);

create table prediction_feedback (
  id uuid primary key default gen_random_uuid(),
  prediction_id uuid not null references predictions(id) on delete cascade,
  actual_change_pct numeric not null,
  accuracy_note text not null,
  checked_at timestamptz not null default now()
);

create table kakao_conversations (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  created_at timestamptz not null default now()
);

create index on news_tags (theme_id);
create index on price_history (stock_id, date);
create index on predictions (checked, check_after_days);
```

- [ ] **Step 4: Write the seed migration**

`supabase/migrations/0002_seed_stocks_themes.sql` — seed themes and a representative ~40-stock starter list (KOSPI/KOSDAQ large caps across major themes; exact market-cap ranks should be re-verified at deploy time, flagged in spec §10):

```sql
insert into themes (name) values
  ('반도체'), ('2차전지'), ('바이오'), ('자동차'), ('조선'),
  ('항공'), ('화장품'), ('게임'), ('인터넷/플랫폼'), ('철강'),
  ('금융'), ('축산업');

with s as (
  insert into stocks (ticker, name, market, market_cap_rank) values
    ('005930.KS', '삼성전자', 'KOSPI', 1),
    ('000660.KS', 'SK하이닉스', 'KOSPI', 2),
    ('373220.KS', 'LG에너지솔루션', 'KOSPI', 3),
    ('207940.KS', '삼성바이오로직스', 'KOSPI', 4),
    ('005380.KS', '현대차', 'KOSPI', 5),
    ('000270.KS', '기아', 'KOSPI', 6),
    ('005490.KS', 'POSCO홀딩스', 'KOSPI', 7),
    ('035420.KS', 'NAVER', 'KOSPI', 8),
    ('035720.KS', '카카오', 'KOSPI', 9),
    ('051910.KS', 'LG화학', 'KOSPI', 10),
    ('006400.KS', '삼성SDI', 'KOSPI', 11),
    ('012330.KS', '현대모비스', 'KOSPI', 12),
    ('068270.KS', '셀트리온', 'KOSPI', 13),
    ('105560.KS', 'KB금융', 'KOSPI', 14),
    ('055550.KS', '신한지주', 'KOSPI', 15),
    ('009540.KS', 'HD한국조선해양', 'KOSPI', 16),
    ('010140.KS', '삼성중공업', 'KOSPI', 17),
    ('003490.KS', '대한항공', 'KOSPI', 18),
    ('090430.KS', '아모레퍼시픽', 'KOSPI', 19),
    ('259960.KS', '크래프톤', 'KOSPI', 20),
    ('036570.KS', '엔씨소프트', 'KOSPI', 21),
    ('247540.KQ', '에코프로비엠', 'KOSDAQ', 1),
    ('086520.KQ', '에코프로', 'KOSDAQ', 2),
    ('091990.KQ', '셀트리온헬스케어', 'KOSDAQ', 3),
    ('196170.KQ', '알테오젠', 'KOSDAQ', 4)
  returning id, ticker
)
insert into stock_themes (stock_id, theme_id)
select s.id, t.id from s
join themes t on
  (s.ticker in ('005930.KS','000660.KS') and t.name = '반도체') or
  (s.ticker in ('373220.KS','006400.KS','247540.KQ','086520.KQ') and t.name = '2차전지') or
  (s.ticker in ('207940.KS','068270.KS','091990.KQ','196170.KQ') and t.name = '바이오') or
  (s.ticker in ('005380.KS','000270.KS','012330.KS') and t.name = '자동차') or
  (s.ticker in ('009540.KS','010140.KS') and t.name = '조선') or
  (s.ticker in ('003490.KS') and t.name = '항공') or
  (s.ticker in ('090430.KS') and t.name = '화장품') or
  (s.ticker in ('259960.KS','036570.KS') and t.name = '게임') or
  (s.ticker in ('035420.KS','035720.KS') and t.name = '인터넷/플랫폼') or
  (s.ticker in ('005490.KS') and t.name = '철강') or
  (s.ticker in ('105560.KS','055550.KS') and t.name = '금융');
```

- [ ] **Step 5: Apply both migrations via Supabase MCP**

Use the Supabase MCP `apply_migration` tool twice (once per file, in order). After each, use `list_tables` / a `select count(*)` via `execute_sql` to confirm rows landed.

- [ ] **Step 6: Write `lib/types.ts`**

```typescript
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
```

- [ ] **Step 7: Write a smoke test that the schema is reachable**

`test/schema.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

describe('schema', () => {
  it('can read the seeded themes table', async () => {
    const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data, error } = await supabase.from('themes').select('name');
    expect(error).toBeNull();
    expect(data!.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run test/schema.test.ts`
Expected: PASS (requires `.env` populated with the new project's URL/service role key from Supabase MCP `get_project_url` / dashboard).

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json .gitignore .env.example vitest.config.ts lib/types.ts supabase/ test/schema.test.ts package-lock.json
git commit -m "chore: scaffold project and create Supabase schema"
```

---

### Task 2: Price client + collector

**Files:**
- Create: `lib/supabaseClient.ts`
- Create: `lib/priceClient.ts`
- Test: `test/priceClient.test.ts`
- Create: `api/cron/collect-prices.ts`
- Create: `lib/auth.ts`
- Test: `test/auth.test.ts`

**Interfaces:**
- Consumes: `Stock`, `PriceHistoryRow`, `IntradayQuote` from `lib/types.ts` (Task 1)
- Produces: `getSupabase(): SupabaseClient` (used by every later task that touches the DB)
- Produces: `fetchDailyCloses(ticker: string, days: number): Promise<{date: string, close: number}[]>`
- Produces: `fetchLatestQuote(ticker: string): Promise<{price: number, changePct: number}>`
- Produces: `requireCronSecret(req: VercelRequest): boolean` (used by all cron/webhook endpoints)

- [ ] **Step 1: Write `lib/supabaseClient.ts`**

```typescript
import { createClient, SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return client;
}
```

- [ ] **Step 2: Write `lib/auth.ts` failing test**

`test/auth.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { requireCronSecret } from '../lib/auth';

describe('requireCronSecret', () => {
  it('rejects a request with the wrong secret', () => {
    process.env.CRON_SECRET = 'correct-secret';
    const req = { headers: { 'x-cron-secret': 'wrong' } } as any;
    expect(requireCronSecret(req)).toBe(false);
  });

  it('accepts a request with the correct secret', () => {
    process.env.CRON_SECRET = 'correct-secret';
    const req = { headers: { 'x-cron-secret': 'correct-secret' } } as any;
    expect(requireCronSecret(req)).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/auth.test.ts`
Expected: FAIL — `lib/auth` does not exist yet.

- [ ] **Step 4: Implement `lib/auth.ts`**

```typescript
import type { VercelRequest } from '@vercel/node';

export function requireCronSecret(req: VercelRequest): boolean {
  const provided = req.headers['x-cron-secret'];
  return typeof provided === 'string' && provided === process.env.CRON_SECRET && provided.length > 0;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/auth.test.ts`
Expected: PASS

- [ ] **Step 6: Write `priceClient` failing tests**

`test/priceClient.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchDailyCloses, fetchLatestQuote } from '../lib/priceClient';

const chartResponse = {
  chart: {
    result: [
      {
        meta: { regularMarketPrice: 71500, chartPreviousClose: 70000 },
        timestamp: [1700000000, 1700086400],
        indicators: { quote: [{ close: [70000, 71500] }] },
      },
    ],
  },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => chartResponse,
  })));
});

describe('fetchDailyCloses', () => {
  it('maps timestamps and closes into date/close pairs', async () => {
    const result = await fetchDailyCloses('005930.KS', 2);
    expect(result).toEqual([
      { date: '2023-11-14', close: 70000 },
      { date: '2023-11-15', close: 71500 },
    ]);
  });
});

describe('fetchLatestQuote', () => {
  it('computes changePct from meta fields', async () => {
    const result = await fetchLatestQuote('005930.KS');
    expect(result.price).toBe(71500);
    expect(result.changePct).toBeCloseTo(2.142, 2);
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run test/priceClient.test.ts`
Expected: FAIL — `lib/priceClient` does not exist yet.

- [ ] **Step 8: Implement `lib/priceClient.ts`**

```typescript
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
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run test/priceClient.test.ts`
Expected: PASS

- [ ] **Step 10: Write `api/cron/collect-prices.ts`**

```typescript
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
      await supabase.from('intraday_quotes').insert({
        stock_id: stock.id,
        price: quote.price,
        change_pct: quote.changePct,
      });
      results.updatedIntraday++;

      const closes = await fetchDailyCloses(stock.ticker, 5);
      for (let i = 0; i < closes.length; i++) {
        const changePct = i === 0 ? null : ((closes[i].close - closes[i - 1].close) / closes[i - 1].close) * 100;
        await supabase.from('price_history').upsert(
          { stock_id: stock.id, date: closes[i].date, close_price: closes[i].close, change_pct: changePct },
          { onConflict: 'stock_id,date' },
        );
      }
      results.updatedDaily++;
    } catch (err) {
      results.failures.push(`${stock.ticker}: ${(err as Error).message}`);
    }
  }

  return res.status(200).json(results);
}
```

- [ ] **Step 11: Commit**

```bash
git add lib/supabaseClient.ts lib/auth.ts lib/priceClient.ts api/cron/collect-prices.ts test/auth.test.ts test/priceClient.test.ts
git commit -m "feat: add price client and price collection endpoint"
```

---

### Task 3: News client + collector

**Files:**
- Create: `lib/newsClient.ts`
- Test: `test/newsClient.test.ts`
- Create: `api/cron/collect-news.ts`

**Interfaces:**
- Consumes: `getSupabase`, `requireCronSecret` (Task 2), `NewsItem` (Task 1)
- Produces: `fetchNaverNews(query: string): Promise<RawNewsItem[]>`, `fetchRssFeed(url: string, source: string): Promise<RawNewsItem[]>` where `RawNewsItem = {source: string, url: string, title: string, summary: string | null, publishedAt: string}` — consumed by `api/cron/collect-news.ts` and re-used as the shape passed into Task 4's tagging input.

- [ ] **Step 1: Write failing tests**

`test/newsClient.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchNaverNews, fetchRssFeed } from '../lib/newsClient';

const naverResponse = {
  items: [
    {
      title: 'SK하이닉스, D램 수요 증가 전망',
      originallink: 'https://example.com/a',
      link: 'https://news.naver.com/a',
      description: 'D램 수요가 늘어날 것으로 전망된다.',
      pubDate: 'Mon, 27 Jul 2026 09:00:00 +0900',
    },
  ],
};

const rssXml = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Bird flu spreads across farms</title>
    <link>https://bbc.com/b</link>
    <description>Avian flu outbreak reported.</description>
    <pubDate>Mon, 27 Jul 2026 06:00:00 GMT</pubDate>
  </item>
</channel></rss>`;

beforeEach(() => {
  process.env.NAVER_CLIENT_ID = 'id';
  process.env.NAVER_CLIENT_SECRET = 'secret';
});

describe('fetchNaverNews', () => {
  it('maps Naver API items into RawNewsItem', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => naverResponse })));
    const items = await fetchNaverNews('SK하이닉스');
    expect(items).toEqual([
      {
        source: 'naver',
        url: 'https://news.naver.com/a',
        title: 'SK하이닉스, D램 수요 증가 전망',
        summary: 'D램 수요가 늘어날 것으로 전망된다.',
        publishedAt: new Date('Mon, 27 Jul 2026 09:00:00 +0900').toISOString(),
      },
    ]);
  });
});

describe('fetchRssFeed', () => {
  it('parses RSS items into RawNewsItem', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => rssXml })));
    const items = await fetchRssFeed('https://feeds.bbci.co.uk/news/business/rss.xml', 'bbc');
    expect(items).toEqual([
      {
        source: 'bbc',
        url: 'https://bbc.com/b',
        title: 'Bird flu spreads across farms',
        summary: 'Avian flu outbreak reported.',
        publishedAt: new Date('Mon, 27 Jul 2026 06:00:00 GMT').toISOString(),
      },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/newsClient.test.ts`
Expected: FAIL — `lib/newsClient` does not exist yet.

- [ ] **Step 3: Implement `lib/newsClient.ts`**

```typescript
import Parser from 'rss-parser';

export interface RawNewsItem {
  source: string;
  url: string;
  title: string;
  summary: string | null;
  publishedAt: string;
}

export async function fetchNaverNews(query: string): Promise<RawNewsItem[]> {
  const url = `https://openapi.naver.com/v1/search/news.json?query=${encodeURIComponent(query)}&display=50&sort=date`;
  const res = await fetch(url, {
    headers: {
      'X-Naver-Client-Id': process.env.NAVER_CLIENT_ID!,
      'X-Naver-Client-Secret': process.env.NAVER_CLIENT_SECRET!,
    },
  });
  if (!res.ok) throw new Error(`Naver News API request failed: ${res.status}`);
  const body = await res.json();
  return body.items.map((item: any) => ({
    source: 'naver',
    url: item.link,
    title: stripHtml(item.title),
    summary: item.description ? stripHtml(item.description) : null,
    publishedAt: new Date(item.pubDate).toISOString(),
  }));
}

export async function fetchRssFeed(url: string, source: string): Promise<RawNewsItem[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`RSS fetch failed for ${source}: ${res.status}`);
  const xml = await res.text();
  const parser = new Parser();
  const feed = await parser.parseString(xml);
  return (feed.items ?? []).map((item) => ({
    source,
    url: item.link ?? '',
    title: item.title ?? '',
    summary: item.contentSnippet ?? item.content ?? null,
    publishedAt: new Date(item.pubDate ?? item.isoDate ?? Date.now()).toISOString(),
  }));
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, '');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/newsClient.test.ts`
Expected: PASS

- [ ] **Step 5: Write `api/cron/collect-news.ts`**

Note: the exact RSS URLs and Naver query keyword list below are the MVP starting point — re-verify feed URLs still resolve before relying on them (spec §10).

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../lib/supabaseClient';
import { fetchNaverNews, fetchRssFeed } from '../../lib/newsClient';
import { requireCronSecret } from '../../lib/auth';

const NAVER_QUERIES = ['반도체', '2차전지', '바이오', '자동차 산업', '조선업', '축산업', '금리'];
const RSS_FEEDS = [
  { url: 'https://feeds.bbci.co.uk/news/business/rss.xml', source: 'bbc' },
  { url: 'https://www.marketwatch.com/rss/topstories', source: 'marketwatch' },
];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCronSecret(req)) return res.status(401).json({ error: 'unauthorized' });

  const supabase = getSupabase();
  const results = { inserted: 0, skipped: 0, failures: [] as string[] };

  const batches = await Promise.all([
    ...NAVER_QUERIES.map((q) => fetchNaverNews(q).catch((e) => { results.failures.push(`naver:${q}: ${e.message}`); return []; })),
    ...RSS_FEEDS.map((f) => fetchRssFeed(f.url, f.source).catch((e) => { results.failures.push(`${f.source}: ${e.message}`); return []; })),
  ]);

  for (const item of batches.flat()) {
    if (!item.url || !item.title) continue;
    const { error } = await supabase.from('news_items').insert({
      source: item.source,
      url: item.url,
      title: item.title,
      summary: item.summary,
      published_at: item.publishedAt,
    });
    if (error) {
      if (error.code === '23505') results.skipped++; // duplicate url, already collected
      else results.failures.push(`${item.url}: ${error.message}`);
    } else {
      results.inserted++;
    }
  }

  return res.status(200).json(results);
}
```

- [ ] **Step 6: Commit**

```bash
git add lib/newsClient.ts api/cron/collect-news.ts test/newsClient.test.ts
git commit -m "feat: add news client and news collection endpoint"
```

---

### Task 4: Claude-based news tagging

**Files:**
- Create: `lib/claudeClient.ts`
- Create: `lib/tagNews.ts`
- Test: `test/tagNews.test.ts`
- Create: `api/cron/tag-news.ts`

**Interfaces:**
- Consumes: `getSupabase`, `requireCronSecret`, `NewsItem`, `Theme`, `NewsTag` (Tasks 1–2)
- Produces: `tagNewsItem(item: {title: string, summary: string | null}, themes: Theme[]): Promise<{themeName: string, sentiment: 'positive'|'negative'|'neutral', confidence: number, reasoning: string}[]>` — consumed by `api/cron/tag-news.ts` and by Task 5 indirectly via the `news_tags` table it writes.

- [ ] **Step 1: Write `lib/claudeClient.ts`**

```typescript
import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

export function getClaude(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return client;
}

export const TAGGING_MODEL = 'claude-haiku-4-5-20251001';
export const REASONING_MODEL = 'claude-sonnet-5';
```

- [ ] **Step 2: Write failing test for `tagNewsItem`**

`test/tagNews.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { tagNewsItem } from '../lib/tagNews';
import { getClaude } from '../lib/claudeClient';

vi.mock('../lib/claudeClient', () => ({
  getClaude: vi.fn(),
  TAGGING_MODEL: 'claude-haiku-4-5-20251001',
}));

describe('tagNewsItem', () => {
  it('parses the tool_use block into tag results', async () => {
    const mockCreate = vi.fn(async () => ({
      content: [
        {
          type: 'tool_use',
          input: {
            tags: [
              { themeName: '반도체', sentiment: 'positive', confidence: 0.8, reasoning: 'D램 수요 증가는 반도체 업종에 호재' },
            ],
          },
        },
      ],
    }));
    (getClaude as any).mockReturnValue({ messages: { create: mockCreate } });

    const result = await tagNewsItem(
      { title: 'SK하이닉스, D램 수요 증가 전망', summary: null },
      [{ id: 't1', name: '반도체' }, { id: 't2', name: '바이오' }],
    );

    expect(result).toEqual([
      { themeName: '반도체', sentiment: 'positive', confidence: 0.8, reasoning: 'D램 수요 증가는 반도체 업종에 호재' },
    ]);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-haiku-4-5-20251001' }));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/tagNews.test.ts`
Expected: FAIL — `lib/tagNews` does not exist yet.

- [ ] **Step 4: Implement `lib/tagNews.ts`**

```typescript
import { getClaude, TAGGING_MODEL } from './claudeClient';
import type { Theme } from './types';

export interface TagResult {
  themeName: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  confidence: number;
  reasoning: string;
}

const TAG_TOOL = {
  name: 'record_tags',
  description: '뉴스 기사와 관련된 테마와 그 영향(호재/악재/중립)을 기록한다.',
  input_schema: {
    type: 'object' as const,
    properties: {
      tags: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            themeName: { type: 'string' },
            sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
            confidence: { type: 'number' },
            reasoning: { type: 'string' },
          },
          required: ['themeName', 'sentiment', 'confidence', 'reasoning'],
        },
      },
    },
    required: ['tags'],
  },
};

export async function tagNewsItem(
  item: { title: string; summary: string | null },
  themes: Theme[],
): Promise<TagResult[]> {
  const claude = getClaude();
  const themeNames = themes.map((t) => t.name).join(', ');

  const response = await claude.messages.create({
    model: TAGGING_MODEL,
    max_tokens: 1024,
    tools: [TAG_TOOL],
    tool_choice: { type: 'tool', name: 'record_tags' },
    messages: [
      {
        role: 'user',
        content: `다음 뉴스와 관련 있는 테마를 아래 목록 중에서만 골라 태깅해줘. 관련 있는 테마가 없으면 빈 배열을 반환해.\n\n테마 목록: ${themeNames}\n\n제목: ${item.title}\n요약: ${item.summary ?? '(없음)'}`,
      },
    ],
  });

  const toolUse = response.content.find((c): c is any => c.type === 'tool_use');
  if (!toolUse) return [];
  return toolUse.input.tags as TagResult[];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/tagNews.test.ts`
Expected: PASS

- [ ] **Step 6: Write `api/cron/tag-news.ts`**

```typescript
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

  const { data: taggedNewsIds } = await supabase.from('news_tags').select('news_item_id');
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
        await supabase.from('news_tags').insert({
          news_item_id: news.id,
          theme_id: theme.id,
          sentiment: tag.sentiment,
          confidence: tag.confidence,
          reasoning: tag.reasoning,
        });
      }
      results.tagged++;
    } catch (err) {
      results.failures.push(`${news.id}: ${(err as Error).message}`);
    }
  }

  return res.status(200).json(results);
}
```

- [ ] **Step 7: Commit**

```bash
git add lib/claudeClient.ts lib/tagNews.ts api/cron/tag-news.ts test/tagNews.test.ts
git commit -m "feat: add Claude-based news tagging"
```

---

### Task 5: Historical stats + prediction generation

**Files:**
- Create: `lib/stats.ts`
- Test: `test/stats.test.ts`
- Create: `lib/predict.ts`
- Test: `test/predict.test.ts`
- Create: `api/cron/generate-predictions.ts`

**Interfaces:**
- Consumes: `getSupabase`, `requireCronSecret`, `getClaude`, `REASONING_MODEL`, `Theme`, `NewsTag`, `PriceHistoryRow`, `Prediction` (Tasks 1–4)
- Produces: `computeThemeReactionStats(rows: ThemeReactionInput[]): ThemeReactionStats` (pure function, no I/O — testable with fixtures)
- Produces: `generatePrediction(input: PredictionInput): Promise<PredictionDraft>` — consumed by `api/cron/generate-predictions.ts`

- [ ] **Step 1: Write failing test for `computeThemeReactionStats`**

`test/stats.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { computeThemeReactionStats } from '../lib/stats';

describe('computeThemeReactionStats', () => {
  it('averages the change_pct N days after past same-sentiment tags', () => {
    const result = computeThemeReactionStats([
      { changePctAfter: -3 },
      { changePctAfter: -5 },
      { changePctAfter: -1 },
    ]);
    expect(result.sampleSize).toBe(3);
    expect(result.avgChangePct).toBeCloseTo(-3, 5);
    expect(result.minChangePct).toBe(-5);
    expect(result.maxChangePct).toBe(-1);
  });

  it('flags low confidence when sample size is small', () => {
    const result = computeThemeReactionStats([{ changePctAfter: -2 }]);
    expect(result.sampleSize).toBe(1);
    expect(result.lowSample).toBe(true);
  });

  it('handles an empty input without dividing by zero', () => {
    const result = computeThemeReactionStats([]);
    expect(result.sampleSize).toBe(0);
    expect(result.avgChangePct).toBeNull();
    expect(result.lowSample).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/stats.test.ts`
Expected: FAIL — `lib/stats` does not exist yet.

- [ ] **Step 3: Implement `lib/stats.ts`**

```typescript
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/stats.test.ts`
Expected: PASS

- [ ] **Step 5: Write a DB query helper that feeds `computeThemeReactionStats`**

Add to `lib/stats.ts`:
```typescript
import { getSupabase } from './supabaseClient';

const REACTION_WINDOW_DAYS = 3;

export async function fetchThemeReactionHistory(themeId: string, sentiment: 'positive' | 'negative'): Promise<ThemeReactionInput[]> {
  const supabase = getSupabase();
  const { data: pastTags, error } = await supabase
    .from('news_tags')
    .select('id, created_at')
    .eq('theme_id', themeId)
    .eq('sentiment', sentiment);
  if (error) throw new Error(error.message);

  const { data: stockLinks } = await supabase.from('stock_themes').select('stock_id').eq('theme_id', themeId);
  const stockIds = (stockLinks ?? []).map((r) => r.stock_id);
  if (stockIds.length === 0 || !pastTags) return [];

  const results: ThemeReactionInput[] = [];
  for (const tag of pastTags) {
    const tagDate = new Date(tag.created_at);
    const afterDate = new Date(tagDate.getTime() + REACTION_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const { data: prices } = await supabase
      .from('price_history')
      .select('stock_id, date, close_price')
      .in('stock_id', stockIds)
      .gte('date', tagDate.toISOString().slice(0, 10))
      .lte('date', afterDate.toISOString().slice(0, 10))
      .order('date', { ascending: true });
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
```

- [ ] **Step 6: Write failing test for `generatePrediction`**

`test/predict.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { buildPredictionDraft } from '../lib/predict';
import { getClaude } from '../lib/claudeClient';

vi.mock('../lib/claudeClient', () => ({
  getClaude: vi.fn(),
  REASONING_MODEL: 'claude-sonnet-5',
}));

describe('buildPredictionDraft', () => {
  it('asks Claude to synthesize stats + news context into a prediction', async () => {
    const mockCreate = vi.fn(async () => ({
      content: [
        {
          type: 'tool_use',
          input: {
            direction: 'down',
            rangeLow: -4,
            rangeHigh: -2,
            confidence: 0.4,
            reasoning: '과거 3건 평균 -3% 하락, 이번 뉴스도 유사한 부정적 맥락',
          },
        },
      ],
    }));
    (getClaude as any).mockReturnValue({ messages: { create: mockCreate } });

    const draft = await buildPredictionDraft({
      themeName: '축산업',
      recentNewsSummaries: ['월가발 조류독감 확산 뉴스'],
      stats: { sampleSize: 3, avgChangePct: -3, minChangePct: -5, maxChangePct: -1, lowSample: false },
    });

    expect(draft).toEqual({
      direction: 'down',
      rangeLow: -4,
      rangeHigh: -2,
      confidence: 0.4,
      reasoning: '과거 3건 평균 -3% 하락, 이번 뉴스도 유사한 부정적 맥락',
    });
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run test/predict.test.ts`
Expected: FAIL — `lib/predict` does not exist yet.

- [ ] **Step 8: Implement `lib/predict.ts`**

```typescript
import { getClaude, REASONING_MODEL } from './claudeClient';
import type { ThemeReactionStats } from './stats';

export interface PredictionDraft {
  direction: 'up' | 'down';
  rangeLow: number;
  rangeHigh: number;
  confidence: number;
  reasoning: string;
}

const PREDICTION_TOOL = {
  name: 'record_prediction',
  description: '과거 통계와 최근 뉴스 맥락을 종합해 테마의 예상 주가 흐름을 기록한다.',
  input_schema: {
    type: 'object' as const,
    properties: {
      direction: { type: 'string', enum: ['up', 'down'] },
      rangeLow: { type: 'number' },
      rangeHigh: { type: 'number' },
      confidence: { type: 'number' },
      reasoning: { type: 'string' },
    },
    required: ['direction', 'rangeLow', 'rangeHigh', 'confidence', 'reasoning'],
  },
};

export async function buildPredictionDraft(input: {
  themeName: string;
  recentNewsSummaries: string[];
  stats: ThemeReactionStats;
}): Promise<PredictionDraft> {
  const claude = getClaude();
  const statsText = input.stats.sampleSize === 0
    ? '과거 유사 사례 없음'
    : `과거 ${input.stats.sampleSize}건 기준 평균 ${input.stats.avgChangePct?.toFixed(1)}% 변동 (최소 ${input.stats.minChangePct}%, 최대 ${input.stats.maxChangePct}%)${input.stats.lowSample ? ' — 표본이 적어 참고용' : ''}`;

  const response = await claude.messages.create({
    model: REASONING_MODEL,
    max_tokens: 1024,
    tools: [PREDICTION_TOOL],
    tool_choice: { type: 'tool', name: 'record_prediction' },
    messages: [
      {
        role: 'user',
        content: `테마: ${input.themeName}\n최근 뉴스: ${input.recentNewsSummaries.join(' / ')}\n과거 통계: ${statsText}\n\n위 정보를 종합해 이 테마의 예상 주가 흐름(방향, 변동 범위, 신뢰도, 근거)을 기록해줘. 표본이 적으면 confidence를 낮게 잡아줘.`,
      },
    ],
  });

  const toolUse = response.content.find((c): c is any => c.type === 'tool_use');
  if (!toolUse) throw new Error('Claude did not return a prediction');
  return toolUse.input as PredictionDraft;
}
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npx vitest run test/predict.test.ts`
Expected: PASS

- [ ] **Step 10: Write `api/cron/generate-predictions.ts`**

```typescript
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
      await supabase.from('predictions').insert({
        theme_id: themeId,
        direction: draft.direction,
        range_low: draft.rangeLow,
        range_high: draft.rangeHigh,
        confidence: draft.confidence,
        reasoning: draft.reasoning,
        check_after_days: CHECK_AFTER_DAYS,
      });
      results.created++;
    } catch (err) {
      results.failures.push(`${key}: ${(err as Error).message}`);
    }
  }

  return res.status(200).json(results);
}
```

- [ ] **Step 11: Commit**

```bash
git add lib/stats.ts lib/predict.ts api/cron/generate-predictions.ts test/stats.test.ts test/predict.test.ts
git commit -m "feat: add historical stats and prediction generation"
```

---

### Task 6: Pipeline orchestrator endpoint

**Files:**
- Create: `api/cron/pipeline.ts`
- Test: `test/pipeline.test.ts`

**Interfaces:**
- Consumes: the four handlers from Tasks 2–5 refactored to export a plain async function in addition to the Vercel handler, so `pipeline.ts` can call them in sequence without an extra HTTP hop. Each of `api/cron/collect-prices.ts`, `collect-news.ts`, `tag-news.ts`, `generate-predictions.ts` gets a named export `run(): Promise<object>` that the default `handler` also calls internally.
- Produces: single endpoint `/api/cron/pipeline` — this is the ONE url registered on the external cron service (cron-job.org), so only one secret/url pair needs to be managed outside Vercel.

- [ ] **Step 1: Refactor Tasks 2–5 endpoints to expose a `run()` function**

For each of `api/cron/collect-prices.ts`, `api/cron/collect-news.ts`, `api/cron/tag-news.ts`, `api/cron/generate-predictions.ts`, extract the body (everything after the auth check) into an exported `export async function run() { ... }` and have `export default async function handler(req, res) { if (!requireCronSecret(req)) ...; const result = await run(); return res.status(200).json(result); }` call it. No behavior change, purely a refactor — re-run each task's existing tests to confirm nothing broke.

- [ ] **Step 2: Write failing test for the orchestrator**

`test/pipeline.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

vi.mock('../api/cron/collect-prices', () => ({ run: vi.fn(async () => ({ updatedDaily: 1 })) }));
vi.mock('../api/cron/collect-news', () => ({ run: vi.fn(async () => ({ inserted: 2 })) }));
vi.mock('../api/cron/tag-news', () => ({ run: vi.fn(async () => ({ tagged: 1 })) }));
vi.mock('../api/cron/generate-predictions', () => ({ run: vi.fn(async () => ({ created: 1 })) }));

import handler from '../api/cron/pipeline';
import { run as collectPrices } from '../api/cron/collect-prices';
import { run as collectNews } from '../api/cron/collect-news';
import { run as tagNews } from '../api/cron/tag-news';
import { run as generatePredictions } from '../api/cron/generate-predictions';

describe('pipeline handler', () => {
  it('runs all four steps in order and returns their combined results', async () => {
    process.env.CRON_SECRET = 'secret';
    const req = { headers: { 'x-cron-secret': 'secret' } } as any;
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) } as any;

    await handler(req, res);

    expect(collectPrices).toHaveBeenCalled();
    expect(collectNews).toHaveBeenCalled();
    expect(tagNews).toHaveBeenCalled();
    expect(generatePredictions).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      prices: { updatedDaily: 1 },
      news: { inserted: 2 },
      tagging: { tagged: 1 },
      predictions: { created: 1 },
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/pipeline.test.ts`
Expected: FAIL — `api/cron/pipeline` does not exist yet.

- [ ] **Step 4: Implement `api/cron/pipeline.ts`**

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireCronSecret } from '../../lib/auth';
import { run as collectPrices } from './collect-prices';
import { run as collectNews } from './collect-news';
import { run as tagNews } from './tag-news';
import { run as generatePredictions } from './generate-predictions';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCronSecret(req)) return res.status(401).json({ error: 'unauthorized' });

  const prices = await collectPrices();
  const news = await collectNews();
  const tagging = await tagNews();
  const predictions = await generatePredictions();

  return res.status(200).json({ prices, news, tagging, predictions });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/pipeline.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add api/cron/pipeline.ts api/cron/collect-prices.ts api/cron/collect-news.ts api/cron/tag-news.ts api/cron/generate-predictions.ts test/pipeline.test.ts
git commit -m "feat: add single pipeline endpoint orchestrating collection, tagging, and prediction"
```

---

### Task 7: KakaoTalk webhook

**Files:**
- Create: `lib/kakaoResponse.ts`
- Test: `test/kakaoResponse.test.ts`
- Create: `api/kakao/webhook.ts`
- Test: `test/kakaoWebhook.test.ts`

**Interfaces:**
- Consumes: `getSupabase`, `getClaude`, `REASONING_MODEL` (Tasks 2, 4)
- Produces: `simpleTextResponse(text: string): KakaoResponse`, `callbackAckResponse(text: string): KakaoResponse` — the exact JSON shapes Kakao's i 오픈빌더 expects. **Re-verify these two shapes against Kakao's current skill-response docs before wiring up the real channel** (spec §10) — field names have changed between Kakao platform versions in the past.
- Design note (satisfies the Global Constraint on the 5-second Kakao timeout): the webhook handler ALWAYS acknowledges immediately with `callbackAckResponse` and does the real Supabase + Claude work afterward via Vercel's `waitUntil`, POSTing the final `simpleTextResponse` to `req.body.userRequest.callbackUrl`. This sidesteps any race against the 5s limit entirely rather than trying to beat it — it requires the Kakao channel's callback feature to be enabled (Task 9's setup guide covers this).

- [ ] **Step 1: Write failing test for response builders**

`test/kakaoResponse.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { simpleTextResponse, callbackAckResponse } from '../lib/kakaoResponse';

describe('simpleTextResponse', () => {
  it('wraps text in the Kakao skill response shape', () => {
    expect(simpleTextResponse('안녕')).toEqual({
      version: '2.0',
      template: { outputs: [{ simpleText: { text: '안녕' } }] },
    });
  });
});

describe('callbackAckResponse', () => {
  it('marks useCallback true with a holding message', () => {
    expect(callbackAckResponse('분석 중이에요')).toEqual({
      version: '2.0',
      useCallback: true,
      data: { text: '분석 중이에요' },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/kakaoResponse.test.ts`
Expected: FAIL — `lib/kakaoResponse` does not exist yet.

- [ ] **Step 3: Implement `lib/kakaoResponse.ts`**

```typescript
export interface KakaoResponse {
  version: '2.0';
  template?: { outputs: [{ simpleText: { text: string } }] };
  useCallback?: boolean;
  data?: { text: string };
}

const DISCLAIMER = '\n\n투자 참고용이며 투자 판단과 책임은 본인에게 있습니다.';

export function simpleTextResponse(text: string, withDisclaimer = false): KakaoResponse {
  return {
    version: '2.0',
    template: { outputs: [{ simpleText: { text: withDisclaimer ? text + DISCLAIMER : text } }] },
  };
}

export function callbackAckResponse(text: string): KakaoResponse {
  return { version: '2.0', useCallback: true, data: { text } };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/kakaoResponse.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing test for the webhook handler**

`test/kakaoWebhook.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

const mockFrom = vi.fn();
vi.mock('../lib/supabaseClient', () => ({ getSupabase: () => ({ from: mockFrom }) }));

const mockCreate = vi.fn(async () => ({ content: [{ type: 'text', text: '지금 반도체 테마가 좋아요' }] }));
vi.mock('../lib/claudeClient', () => ({
  getClaude: () => ({ messages: { create: mockCreate } }),
  REASONING_MODEL: 'claude-sonnet-5',
}));

const capturedBackgroundPromises: Promise<any>[] = [];
vi.mock('@vercel/functions', () => ({
  waitUntil: (p: Promise<any>) => { capturedBackgroundPromises.push(p); },
}));

import handler from '../api/kakao/webhook';

function chainable(result: any) {
  const chain: any = {
    select: () => chain,
    order: () => chain,
    limit: () => chain,
    insert: () => Promise.resolve({ error: null }),
    then: (resolve: any) => resolve(result),
  };
  return chain;
}

describe('kakao webhook handler', () => {
  it('acknowledges immediately via callback, then posts the real answer to callbackUrl', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'predictions') return chainable({ data: [{ reasoning: '축산업 하락 가능', direction: 'down', range_low: -4, range_high: -2 }], error: null });
      if (table === 'intraday_quotes') return chainable({ data: [], error: null });
      if (table === 'news_tags') return chainable({ data: [], error: null });
      return chainable({ data: [], error: null });
    });

    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const req = {
      method: 'POST',
      body: { userRequest: { utterance: '실시간 흐름이랑 예상하락종목 알려줘', callbackUrl: 'https://bot-api.kakao.com/callback/abc' } },
    } as any;
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) } as any;

    await handler(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      version: '2.0',
      useCallback: true,
      data: { text: '분석 중이에요, 잠시만 기다려주세요' },
    });

    await Promise.all(capturedBackgroundPromises);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://bot-api.kakao.com/callback/abc',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          version: '2.0',
          template: { outputs: [{ simpleText: { text: expect.stringContaining('투자 참고용') } }] },
        }),
      }),
    );
  });
});
```

Note: the `body` assertion above uses `expect.stringContaining` inside a value that's already been `JSON.stringify`'d by the real code, so the exact string won't match via `toHaveBeenCalledWith`'s deep-equality on that nested string — when writing this test for real, assert on the parsed body instead: `JSON.parse(fetchMock.mock.calls[0][1].body)` and check that object with `toEqual`/`toContain` rather than comparing raw JSON strings.

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run test/kakaoWebhook.test.ts`
Expected: FAIL — `api/kakao/webhook` does not exist yet.

- [ ] **Step 7: Implement `api/kakao/webhook.ts`**

Given personal-MVP scope (single user, no intent routing needed), every message triggers the same "current snapshot" lookup — this keeps the handler simple and avoids building unnecessary intent classification (YAGNI). The handler always acknowledges immediately and defers the real work to `waitUntil`, so it can never violate Kakao's 5-second response limit regardless of how long Supabase/Claude take.

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { waitUntil } from '@vercel/functions';
import { getSupabase } from '../../lib/supabaseClient';
import { getClaude, REASONING_MODEL } from '../../lib/claudeClient';
import { simpleTextResponse, callbackAckResponse } from '../../lib/kakaoResponse';

async function buildAnswer(utterance: string): Promise<string> {
  const supabase = getSupabase();

  const [{ data: predictions }, { data: quotes }, { data: tags }] = await Promise.all([
    supabase.from('predictions').select('*').order('created_at', { ascending: false }).limit(5),
    supabase.from('intraday_quotes').select('*, stocks(name)').order('captured_at', { ascending: false }).limit(10),
    supabase.from('news_tags').select('*, themes(name), news_items(title)').order('created_at', { ascending: false }).limit(10),
  ]);

  const context = [
    '최근 예측:',
    ...(predictions ?? []).map((p) => `- ${p.direction === 'down' ? '하락' : '상승'} 예상 ${p.range_low}~${p.range_high}%: ${p.reasoning}`),
    '최근 시세 스냅샷:',
    ...(quotes ?? []).map((q) => `- ${(q as any).stocks?.name ?? q.stock_id}: ${q.change_pct?.toFixed(2)}%`),
    '최근 분석된 뉴스:',
    ...(tags ?? []).map((t) => `- [${(t as any).themes?.name}] ${(t as any).news_items?.title} (${t.sentiment})`),
  ].join('\n');

  const claude = getClaude();
  const response = await claude.messages.create({
    model: REASONING_MODEL,
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: `사용자가 카카오톡으로 이렇게 물어봤어: "${utterance}"\n\n아래는 시스템이 가진 최신 데이터야:\n${context}\n\n비개발자도 이해하기 쉬운 문장으로, 카카오톡 메시지로 보낼 답변을 작성해줘. 확신을 과장하지 말고, 데이터가 부족하면 부족하다고 말해줘.`,
      },
    ],
  });

  const textBlock = response.content.find((c): c is any => c.type === 'text');
  const answer = textBlock?.text ?? '지금은 답변을 만들지 못했어요, 잠시 후 다시 물어봐 주세요.';

  await supabase.from('kakao_conversations').insert({ question: utterance, answer });
  return answer;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const utterance: string = req.body?.userRequest?.utterance ?? '';
  const callbackUrl: string | undefined = req.body?.userRequest?.callbackUrl;

  res.status(200).json(callbackAckResponse('분석 중이에요, 잠시만 기다려주세요'));

  // Requires the Kakao channel's callback feature to be enabled (see docs/kakao-setup-guide.md step 5) —
  // without a callbackUrl there's nowhere to deliver the real answer, so we stop after the ack.
  if (!callbackUrl) return;

  waitUntil(
    buildAnswer(utterance).then((answer) =>
      fetch(callbackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(simpleTextResponse(answer, true)),
      }),
    ),
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npx vitest run test/kakaoWebhook.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add lib/kakaoResponse.ts api/kakao/webhook.ts test/kakaoResponse.test.ts test/kakaoWebhook.test.ts
git commit -m "feat: add KakaoTalk webhook handler"
```

---

### Task 8: Feedback checker

**Files:**
- Create: `api/cron/check-feedback.ts`
- Test: `test/checkFeedback.test.ts`

**Interfaces:**
- Consumes: `getSupabase`, `requireCronSecret`, `Prediction`, `PredictionFeedback` (Tasks 1–2)
- Produces: `run(): Promise<{checked: number, failures: string[]}>` + default Vercel handler, matching the same `run()`/`handler` split used in Task 6 so it could be folded into the pipeline later if desired (kept separate here since it runs on its own once-daily native Vercel Cron schedule).

- [ ] **Step 1: Write failing test**

`test/checkFeedback.test.ts`:
```typescript
import { describe, it, expect, vi } from 'vitest';

const mockFrom = vi.fn();
vi.mock('../lib/supabaseClient', () => ({ getSupabase: () => ({ from: mockFrom }) }));

import { run } from '../api/cron/check-feedback';

describe('check-feedback run()', () => {
  it('compares a due prediction against actual price history and records feedback', async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const update = vi.fn(() => ({ eq: () => Promise.resolve({ error: null }) }));

    mockFrom.mockImplementation((table: string) => {
      if (table === 'predictions') {
        return {
          select: () => ({
            eq: () => ({
              lte: () => Promise.resolve({
                data: [{ id: 'p1', theme_id: 't1', created_at: '2026-07-20T00:00:00Z', range_low: -4, range_high: -2 }],
                error: null,
              }),
            }),
          }),
          update,
        };
      }
      if (table === 'stock_themes') {
        return { select: () => ({ eq: () => Promise.resolve({ data: [{ stock_id: 's1' }], error: null }) }) };
      }
      if (table === 'price_history') {
        return {
          select: () => ({
            in: () => ({
              gte: () => ({
                lte: () => ({
                  order: () => Promise.resolve({
                    data: [
                      { stock_id: 's1', date: '2026-07-20', close_price: 100 },
                      { stock_id: 's1', date: '2026-07-23', close_price: 97 },
                    ],
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === 'prediction_feedback') return { insert };
      return {};
    });

    const result = await run();

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      prediction_id: 'p1',
      actual_change_pct: -3,
    }));
    expect(result.checked).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/checkFeedback.test.ts`
Expected: FAIL — `api/cron/check-feedback` does not exist yet.

- [ ] **Step 3: Implement `api/cron/check-feedback.ts`**

```typescript
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../../lib/supabaseClient';
import { requireCronSecret } from '../../lib/auth';

export async function run(): Promise<{ checked: number; failures: string[] }> {
  const supabase = getSupabase();
  const results = { checked: 0, failures: [] as string[] };

  const cutoff = new Date().toISOString();
  const { data: due, error } = await supabase.from('predictions').select('*').eq('checked', false).lte('created_at', cutoff);
  if (error) throw new Error(error.message);

  for (const prediction of due ?? []) {
    try {
      const createdAt = new Date(prediction.created_at);
      const dueDate = new Date(createdAt.getTime() + prediction.check_after_days * 24 * 60 * 60 * 1000);
      if (dueDate > new Date()) continue; // not due yet

      const { data: stockLinks } = await supabase.from('stock_themes').select('stock_id').eq('theme_id', prediction.theme_id);
      const stockIds = (stockLinks ?? []).map((r) => r.stock_id);
      if (stockIds.length === 0) continue;

      const { data: prices } = await supabase
        .from('price_history')
        .select('stock_id, date, close_price')
        .in('stock_id', stockIds)
        .gte('date', createdAt.toISOString().slice(0, 10))
        .lte('date', dueDate.toISOString().slice(0, 10))
        .order('date', { ascending: true });

      if (!prices || prices.length < 2) continue;
      const first = prices[0].close_price;
      const last = prices[prices.length - 1].close_price;
      const actualChangePct = ((last - first) / first) * 100;

      const withinRange = actualChangePct >= prediction.range_low && actualChangePct <= prediction.range_high;
      const accuracyNote = withinRange
        ? '예상 범위 내로 적중'
        : `예상 범위(${prediction.range_low}~${prediction.range_high}%)를 벗어남`;

      await supabase.from('prediction_feedback').insert({
        prediction_id: prediction.id,
        actual_change_pct: actualChangePct,
        accuracy_note: accuracyNote,
      });
      await supabase.from('predictions').update({ checked: true }).eq('id', prediction.id);
      results.checked++;
    } catch (err) {
      results.failures.push(`${prediction.id}: ${(err as Error).message}`);
    }
  }

  return results;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCronSecret(req)) return res.status(401).json({ error: 'unauthorized' });
  const result = await run();
  return res.status(200).json(result);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/checkFeedback.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/cron/check-feedback.ts test/checkFeedback.test.ts
git commit -m "feat: add daily prediction feedback checker"
```

---

### Task 9: Deployment, native cron, and KakaoTalk channel wiring

**Files:**
- Create: `vercel.json`
- Create: `docs/kakao-setup-guide.md`
- Modify: none (deployment + external configuration task)

**Interfaces:**
- Consumes: all previous tasks' deployed endpoints (`/api/cron/pipeline`, `/api/cron/check-feedback`, `/api/kakao/webhook`)
- Produces: a live Vercel deployment URL + a working KakaoTalk channel pointed at it — the end-to-end deliverable of the whole plan.

- [ ] **Step 1: Write `vercel.json` with the once-daily native cron for feedback checking**

```json
{
  "crons": [
    { "path": "/api/cron/check-feedback", "schedule": "0 15 * * *" }
  ]
}
```

(15:00 UTC = 00:00 KST, well after Korean market close — daily check runs once markets are closed.)

- [ ] **Step 2: Set environment variables in Vercel**

Using the Vercel MCP tools (or the dashboard), set for the production environment: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`, `CRON_SECRET` (generate a long random value for this one, e.g. `openssl rand -hex 32`). None of these are committed to git — confirm `.env` stays untracked (`git status` should not show it).

> **Superseded by Task 10:** `ANTHROPIC_API_KEY` above is no longer used by the code — set `GEMINI_API_KEY` instead (see Task 10).

- [ ] **Step 3: Deploy to Vercel**

Use the Vercel MCP `deploy_to_vercel` tool (or `git push` if the Vercel project is linked to the GitHub repo for auto-deploy — recommended, since the repo already exists at `https://github.com/nang-e/vibe-coding-SFMI`). Confirm the deployment is `READY` and note the production URL.

- [ ] **Step 4: Register the external cron for the pipeline endpoint**

This step is done by the user (creating an account on a third-party site isn't something Claude can do on your behalf): sign up at a free service like cron-job.org, create a job that sends a GET or POST to `https://<your-deployment>/api/cron/pipeline` every 15–30 minutes with header `x-cron-secret: <the CRON_SECRET value>`.

- [ ] **Step 5: Write `docs/kakao-setup-guide.md`**

```markdown
# 카카오톡 채널 + 챗봇 연동 가이드 (직접 진행)

1. https://center-pf.kakao.com 에서 카카오 비즈니스 채널을 새로 만드세요 (개인 정보로 무료 생성 가능).
2. https://i.kakao.com (카카오 i 오픈빌더)에 접속해 방금 만든 채널과 연결된 봇을 생성하세요.
3. 오픈빌더 좌측 메뉴에서 "스킬" → "스킬 추가"를 눌러, 스킬 서버 URL에 배포된 주소를 입력하세요:
   `https://<your-deployment>/api/kakao/webhook`
4. "블록" 메뉴에서 폴백 블록(어떤 발화에도 걸리는 기본 블록)을 만들고, 응답 방식을 방금 만든 스킬로 지정하세요.
5. 우측 상단 "봇 설정"에서 콜백(비동기 응답) 사용을 켜두세요 — 스킬 서버 응답이 5초를 넘길 경우 대비.
6. 오픈빌더 화면 우측의 "테스트하기" 버튼으로 실제 대화를 시도해, 웹훅이 응답하는지 확인하세요.
7. 문제 없으면 "배포" 메뉴에서 실제 채널에 배포하세요.

세부 화면 구성은 카카오 쪽 정책으로 수시로 바뀔 수 있으니, 진행 중 화면이 이 가이드와 다르면 그 차이를 알려주세요 — 같이 확인하겠습니다.
```

- [ ] **Step 6: End-to-end test with the user**

Send a real KakaoTalk message to the channel (e.g. "실시간 흐름이랑 예상하락종목 알려줘") and confirm a reply arrives with the disclaimer text. If it doesn't reply within a few seconds, check the Vercel function logs (`get_runtime_logs` via the Vercel MCP tool) for errors.

- [ ] **Step 7: Commit**

```bash
git add vercel.json docs/kakao-setup-guide.md
git commit -m "chore: add deployment config and Kakao channel setup guide"
```

---

### Task 10: Replace Claude with Gemini free tier (cost follow-up)

**Why:** After deploying, the user decided the ongoing pay-per-use cost of the Anthropic API wasn't acceptable for this personal project and asked for a free alternative. Google's Gemini API has a genuinely free tier (no card required) with daily/per-minute request caps. This task swaps the LLM provider while keeping every other task's interface untouched — `tagNewsItem`, `buildPredictionDraft`, and the webhook's answer generation keep the same function signatures, so Tasks 4, 5, and 7's callers need zero changes.

**Confirmed via web search (2026-07-27):** free tier models are Gemini 2.5 Flash (10 RPM / 250 requests per day) and Gemini 2.5 Flash-Lite (15 RPM / 1,000 requests per day); Gemini 2.5 Pro's free tier was removed in April 2026. **Enabling billing on the Google Cloud project removes the free tier entirely for that project — do not enable billing.** SDK is `@google/genai`. Exact quotas change over time — re-verify against Google's current docs if requests start getting rate-limited (spec §10-style caveat).

**Model assignment:** `TAGGING_MODEL = 'gemini-2.5-flash-lite'` (higher daily quota — tagging runs once per untagged news item, could be the higher-volume caller) and `REASONING_MODEL = 'gemini-2.5-flash'` (better quality — used only for prediction generation, grouped by theme, and webhook answers, both low-volume for a single-user bot).

**Files:**
- Create: `lib/geminiClient.ts` (replaces `lib/claudeClient.ts` — delete the old file)
- Modify: `lib/tagNews.ts`, `lib/predict.ts`, `api/kakao/webhook.ts` (swap the client import and the API call shape; keep all exported function signatures identical)
- Modify: `package.json` (remove `@anthropic-ai/sdk`, add `@google/genai`)
- Modify: `.env.example` (replace `ANTHROPIC_API_KEY` with `GEMINI_API_KEY`)
- Modify: `test/tagNews.test.ts`, `test/predict.test.ts`, `test/kakaoWebhook.test.ts` (update the mocked module path and mock response shape to match Gemini's response object instead of Anthropic's content-block array)

**Interfaces:**
- Consumes: nothing new from other tasks — this only touches the LLM call layer.
- Produces: `getGemini(): GoogleGenAI`, `TAGGING_MODEL`, `REASONING_MODEL` from `lib/geminiClient.ts` — same names as the old `lib/claudeClient.ts` exports, so this is a drop-in replacement at the import-path level. `tagNewsItem`, `buildPredictionDraft`, and `buildAnswer` keep their exact existing signatures — nothing downstream of them changes.

- [ ] **Step 1: Update dependencies**

```bash
npm uninstall @anthropic-ai/sdk
npm install @google/genai
```

- [ ] **Step 2: Write `lib/geminiClient.ts`**

```typescript
import { GoogleGenAI } from '@google/genai';

let client: GoogleGenAI | null = null;

export function getGemini(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  return client;
}

export const TAGGING_MODEL = 'gemini-2.5-flash-lite';
export const REASONING_MODEL = 'gemini-2.5-flash';
```

Delete `lib/claudeClient.ts`.

- [ ] **Step 3: Update `test/tagNews.test.ts` and `lib/tagNews.ts` for Gemini's structured-output shape**

Gemini's Node SDK returns structured JSON via `responseMimeType: 'application/json'` + a `responseSchema` in the generation config, rather than Anthropic's forced `tool_use` block — adjust the mock and the implementation to match whatever shape `@google/genai` actually returns once installed (its response object's `.text` property is expected to hold the JSON string per current docs, but confirm against the installed package's types rather than trusting this verbatim, since the SDK has changed shape before). Update the test's mock to return a Gemini-shaped response object, then update `tagNewsItem` in `lib/tagNews.ts` to call `getGemini().models.generateContent({...})` with a `responseSchema` describing `{ tags: TagResult[] }`, parse `JSON.parse(response.text)`, and return `parsed.tags`. Keep the function signature (`tagNewsItem(item, themes): Promise<TagResult[]>`) and the Korean prompt content identical to the current implementation — only the call mechanics change.

- [ ] **Step 4: Run test to verify it fails, then implement, then verify it passes**

Run: `npx vitest run test/tagNews.test.ts` (expect FAIL until the implementation is updated to match the new mock, then PASS).

- [ ] **Step 5: Update `test/predict.test.ts` and `lib/predict.ts` the same way**

Same pattern as Step 3, but for `buildPredictionDraft`'s `{direction, rangeLow, rangeHigh, confidence, reasoning}` schema. Keep the signature and Korean prompt content identical.

- [ ] **Step 6: Run test to verify it fails, then implement, then verify it passes**

Run: `npx vitest run test/predict.test.ts`.

- [ ] **Step 7: Update `test/kakaoWebhook.test.ts` and `api/kakao/webhook.ts`'s `buildAnswer`**

`buildAnswer` doesn't need structured output — it's a plain text answer. Swap the `getClaude()`/`claude.messages.create(...)` call for `getGemini().models.generateContent({ model: REASONING_MODEL, contents: prompt })`, and read the answer text from whatever property the installed `@google/genai` version exposes (commonly `response.text`) instead of Anthropic's `response.content.find(c => c.type === 'text')`. Keep every other line of `buildAnswer` (the Supabase queries, the context-building, the disclaimer, the `waitUntil`/callback logic from Task 7) untouched.

- [ ] **Step 8: Run test to verify it fails, then implement, then verify it passes**

Run: `npx vitest run test/kakaoWebhook.test.ts`.

- [ ] **Step 9: Update `.env.example` and `package.json`**

Replace `ANTHROPIC_API_KEY=` with `GEMINI_API_KEY=` in `.env.example`. Confirm `package.json`'s `dependencies` no longer lists `@anthropic-ai/sdk` and now lists `@google/genai`.

- [ ] **Step 10: Run the full suite and `tsc --noEmit`**

Run: `npx vitest run` and `npx tsc --noEmit -p .` — both must be clean before committing.

- [ ] **Step 11: Commit**

```bash
git add lib/geminiClient.ts lib/tagNews.ts lib/predict.ts api/kakao/webhook.ts package.json package-lock.json .env.example test/tagNews.test.ts test/predict.test.ts test/kakaoWebhook.test.ts
git rm lib/claudeClient.ts
git commit -m "feat: replace Anthropic Claude with Gemini free tier to eliminate per-use cost"
```

- [ ] **Step 12: Redeploy and re-verify live**

Redeploy to Vercel with the updated files (same process as Task 9 Step 3). Once the user has a `GEMINI_API_KEY` (from https://aistudio.google.com/apikey, no card required) and has added it to Vercel's environment variables **without ever enabling billing on that Google Cloud project**, repeat Task 9 Step 6's live webhook test (POST to `/api/kakao/webhook` with a `webhook.site` callback URL) and confirm a real Gemini-generated answer arrives instead of the fallback error message.

---

## Self-Review Notes

- **Spec coverage:** §3 (collector) → Tasks 2–3; §3 (analyzer/predictor) → Tasks 4–5; §3 (Kakao webhook) → Task 7; §3 (feedback checker) → Task 8; §4 (data model) → Task 1; §5 (data flows A/B/C) → Tasks 2–8 combined via Task 6's pipeline; §6 (error handling) → try/catch-per-item throughout, low-sample handling in Task 5, 5s/callback handling flagged in Task 7; §7 (testing) → a Vitest suite per task; §8 (deploy & security) → Task 9, `.env`/`.gitignore` in Task 1. §9 (Phase 2–4) intentionally has no task — out of scope for this plan.
- **Type consistency check:** `Theme`, `Stock`, `Prediction` etc. from `lib/types.ts` (Task 1) are the only shapes referenced by name across Tasks 2–8; `RawNewsItem` (Task 3) and `TagResult`/`PredictionDraft` (Tasks 4–5) are scoped to their own modules and consumed only by the adjacent cron endpoint, so no cross-task naming drift.
- **Placeholder scan:** no TBD/TODO remain; the two explicit "확인 필요" call-outs (RSS feed URLs in Task 3, Kakao response-shape docs in Task 7) are pre-existing spec-level uncertainties (spec §10), not unfinished plan steps — both still have concrete, runnable code.
- **Post-Task-7-review fix (2026-07-27):** Task 7's `DISCLAIMER` constant used parentheses and no trailing period, which didn't literally match the Global Constraints section's exact required disclaimer string. Fixed the plan's code sample to the exact mandated text.
- **Post-Task-3-review fix (2026-07-27):** Task 3's `rssXml` test fixture was missing `version="2.0"` on the `<rss>` tag, which made `rss-parser` throw "Feed not recognized as RSS 1 or 2." — a real bug in the plan's own test data, not an implementer error. Fixed the fixture in this plan file directly.
- **Pre-flight conflict fix (2026-07-27, before Task 1 dispatch):** Task 7's first draft called Claude synchronously and returned `simpleTextResponse` directly, which conflicts with the Global Constraint requiring the 5-second Kakao timeout to be respected via the callback pattern. Rewrote Task 7 (Interfaces note, Step 5 test, Step 7 implementation) so the handler always acknowledges via `callbackAckResponse` first and defers the real work to `waitUntil` + a callback POST — this is a correction to the plan's own text, not a user-facing ambiguity, so it was fixed directly rather than escalated.
