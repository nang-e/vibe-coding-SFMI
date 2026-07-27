insert into stock_themes (stock_id, theme_id)
select s.id, t.id
from stocks s
join themes t on t.name = '2차전지'
where s.ticker = '051910.KS';

alter table stocks enable row level security;
alter table themes enable row level security;
alter table stock_themes enable row level security;
alter table news_items enable row level security;
alter table news_tags enable row level security;
alter table price_history enable row level security;
alter table intraday_quotes enable row level security;
alter table predictions enable row level security;
alter table prediction_feedback enable row level security;
alter table kakao_conversations enable row level security;
