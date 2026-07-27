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
