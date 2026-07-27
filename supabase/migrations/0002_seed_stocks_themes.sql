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
