import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../lib/supabaseClient';

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = getSupabase();
  const { data: predictions, error } = await supabase
    .from('predictions')
    .select('*, themes(name)')
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(`<p>불러오기 실패: ${escapeHtml(error.message)}</p>`);
  }

  const rows = (predictions ?? [])
    .map((p) => {
      const arrow = p.direction === 'down' ? '📉 하락' : '📈 상승';
      const themeName = (p as any).themes?.name ?? '알 수 없음';
      // Server runs in UTC — toLocaleString('ko-KR') alone doesn't convert
      // the timezone, only the number formatting, so it must be pinned to
      // Asia/Seoul explicitly to show actual Korean local time.
      const time = new Date(p.created_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' });
      return `<li class="item">
        <div class="item-head">
          <span class="theme">${escapeHtml(themeName)}</span>
          <span class="direction">${arrow} ${p.range_low}~${p.range_high}%</span>
          <span class="time">${time}</span>
        </div>
        <p class="reasoning">${escapeHtml(p.reasoning)}</p>
      </li>`;
    })
    .join('\n');

  const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>AI 주식비서</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Malgun Gothic", sans-serif; max-width: 640px; margin: 0 auto; padding: 24px 16px; background: #f7f7f8; color: #222; }
  h1 { font-size: 20px; }
  .disclaimer { color: #888; font-size: 13px; margin-bottom: 20px; }
  ul { list-style: none; padding: 0; margin: 0; }
  .item { background: #fff; border-radius: 10px; padding: 14px 16px; margin-bottom: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .item-head { display: flex; flex-wrap: wrap; gap: 8px; align-items: baseline; margin-bottom: 6px; }
  .theme { font-weight: 700; }
  .direction { color: #d33; }
  .time { margin-left: auto; color: #999; font-size: 12px; }
  .reasoning { margin: 0; color: #444; font-size: 14px; line-height: 1.5; }
</style>
</head>
<body>
  <h1>📊 AI 주식비서 — 최근 예측</h1>
  <p class="disclaimer">⚠️ 투자 참고용이며 투자 판단과 책임은 본인에게 있습니다. (카톡으로 받은 내용과 동일)</p>
  <ul>
    ${rows || '<li>아직 예측 기록이 없습니다.</li>'}
  </ul>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
}
