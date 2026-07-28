import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiError } from '@google/genai';
import { getSupabase } from '../../lib/supabaseClient';
import { fetchThemeReactionHistory, computeThemeReactionStats } from '../../lib/stats';
import { buildPredictionDraft, type PredictionDraft } from '../../lib/predict';
import { requireCronSecret } from '../../lib/auth';
import { THEME_OVERSEAS_PEERS, fetchOverseasSignals } from '../../lib/overseasSignal';
import { sendKakaoMemo } from '../../lib/kakaoMemo';

const CHECK_AFTER_DAYS = 3;
// Don't re-predict the same theme more than once per window, whether the
// trigger is fresh domestic news or an overseas leading-indicator move —
// this pipeline can run every 15-30 min and would otherwise spam duplicate
// predictions (and duplicate Kakao pushes) for a theme that's still "hot".
const COOLDOWN_HOURS = 1;
const PUSH_THRESHOLD_PCT = 1;

function isRateLimitError(err: unknown): boolean {
  return err instanceof ApiError && err.status === 429;
}

async function hasRecentPrediction(
  supabase: ReturnType<typeof getSupabase>,
  themeId: string,
  hours: number,
): Promise<boolean> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from('predictions')
    .select('id')
    .eq('theme_id', themeId)
    .gte('created_at', since)
    .limit(1);
  if (error) throw new Error(`cooldown check failed: ${error.message}`);
  return (data ?? []).length > 0;
}

async function insertPrediction(
  supabase: ReturnType<typeof getSupabase>,
  themeId: string,
  draft: PredictionDraft,
): Promise<void> {
  const { error: insertError } = await supabase.from('predictions').insert({
    theme_id: themeId,
    direction: draft.direction,
    range_low: draft.rangeLow,
    range_high: draft.rangeHigh,
    confidence: draft.confidence,
    reasoning: draft.reasoning,
    check_after_days: CHECK_AFTER_DAYS,
  });
  if (insertError) throw new Error(`prediction insert failed: ${insertError.message}`);
}

function exceedsPushThreshold(draft: PredictionDraft): boolean {
  return Math.abs(draft.rangeLow) >= PUSH_THRESHOLD_PCT || Math.abs(draft.rangeHigh) >= PUSH_THRESHOLD_PCT;
}

const HEADER = '📊 [AI 주식비서]';
// Kakao's "나에게 보내기" text template has no bold/rich-text support — the
// warning emoji is the closest we can get to visually emphasizing this line.
const DISCLAIMER = '⚠️ 투자 참고용이며 투자 판단과 책임은 본인에게 있습니다.';

// User asked for readability: '-' reads poorly next to '%', so negative
// values use '△' instead while positives keep their '+'.
function formatPct(n: number): string {
  return n >= 0 ? `+${n}` : `△${Math.abs(n)}`;
}

async function pushPredictionAlert(themeName: string, draft: PredictionDraft): Promise<void> {
  const arrow = draft.direction === 'down' ? '📉 하락' : '📈 상승';
  const text = `${HEADER} ${themeName} 테마 ${arrow} 예상 ${formatPct(draft.rangeLow)}~${formatPct(draft.rangeHigh)}% (약 ${CHECK_AFTER_DAYS}일 내 반영 예상)\n\n${draft.reasoning}\n\n${DISCLAIMER}`;
  await sendKakaoMemo(text);
}

// When this run created nothing push-worthy, still send an hourly heartbeat
// (this endpoint is called roughly once an hour) so the user knows the bot
// is alive, carrying the most recent prediction on file instead of silence.
async function pushNoNewsHeartbeat(supabase: ReturnType<typeof getSupabase>): Promise<void> {
  const { data: latest, error } = await supabase
    .from('predictions')
    .select('theme_id, direction, range_low, range_high, reasoning, created_at, themes(name)')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error || !latest || latest.length === 0) {
    await sendKakaoMemo(`${HEADER} 새로운 소식 없음 — 아직 쌓인 예측 기록도 없어요.\n\n${DISCLAIMER}`);
    return;
  }

  const p = latest[0] as any;
  const arrow = p.direction === 'down' ? '📉 하락' : '📈 상승';
  const themeName = p.themes?.name ?? '알 수 없음';
  const text = `${HEADER} 새로운 소식 없음 — 가장 최근 예측을 다시 보여드려요.\n\n${themeName} 테마 ${arrow} 예상 ${formatPct(p.range_low)}~${formatPct(p.range_high)}% (${new Date(p.created_at).toLocaleString('ko-KR')} 기준, 약 ${CHECK_AFTER_DAYS}일 내 반영 예상)\n${p.reasoning}\n\n${DISCLAIMER}`;
  await sendKakaoMemo(text);
}

export async function run() {
  const supabase = getSupabase();
  const results = { created: 0, pushed: 0, heartbeat: false, failures: [] as string[] };

  const { data: themes, error: themesError } = await supabase.from('themes').select('*');
  if (themesError) throw new Error(themesError.message);
  const themeIdByName = new Map((themes ?? []).map((t) => [t.name, t.id] as const));

  // --- Path 1: fresh domestic news tagged in the last hour ---
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { data: recentTags, error } = await supabase
    .from('news_tags')
    .select('theme_id, sentiment, reasoning, themes(name), news_items(title)')
    .neq('sentiment', 'neutral')
    .gte('created_at', since);
  if (error) throw new Error(error.message);

  const byTheme = new Map<string, { name: string; sentiment: string; summaries: string[] }>();
  for (const tag of recentTags ?? []) {
    const themeName = (tag as any).themes?.name ?? 'unknown';
    const key = `${tag.theme_id}:${tag.sentiment}`;
    if (!byTheme.has(key)) byTheme.set(key, { name: themeName, sentiment: tag.sentiment, summaries: [] });
    byTheme.get(key)!.summaries.push((tag as any).news_items?.title ?? tag.reasoning);
  }

  let processed = 0;
  for (const [key, group] of byTheme) {
    const [themeId] = key.split(':');
    try {
      if (await hasRecentPrediction(supabase, themeId, COOLDOWN_HOURS)) continue;

      const history = await fetchThemeReactionHistory(themeId, group.sentiment as 'positive' | 'negative');
      const stats = computeThemeReactionStats(history);
      const draft = await buildPredictionDraft({ themeName: group.name, recentNewsSummaries: group.summaries, stats });
      await insertPrediction(supabase, themeId, draft);
      results.created++;

      if (exceedsPushThreshold(draft)) {
        await pushPredictionAlert(group.name, draft);
        results.pushed++;
      }
    } catch (err) {
      if (isRateLimitError(err)) {
        results.failures.push(`rate limited, stopping early after ${processed} items`);
        break;
      }
      results.failures.push(`${key}: ${(err as Error).message}`);
    } finally {
      processed++;
    }
  }

  // --- Path 2: overseas leading-indicator peers, independent of domestic news ---
  for (const [themeName, peers] of Object.entries(THEME_OVERSEAS_PEERS)) {
    const themeId = themeIdByName.get(themeName);
    if (!themeId) continue;

    try {
      if (await hasRecentPrediction(supabase, themeId, COOLDOWN_HOURS)) continue;

      const signals = await fetchOverseasSignals(peers);
      const movers = signals.filter((s) => Math.abs(s.changePct) >= PUSH_THRESHOLD_PCT);
      if (movers.length === 0) continue;

      const avgChange = signals.reduce((sum, s) => sum + s.changePct, 0) / signals.length;
      const sentiment: 'positive' | 'negative' = avgChange >= 0 ? 'positive' : 'negative';
      const summaries = signals.map((s) => `${s.name}(${s.ticker}) ${s.changePct >= 0 ? '+' : ''}${s.changePct.toFixed(1)}% (해외 선행지표, 미국 반도체 대형주)`);

      const history = await fetchThemeReactionHistory(themeId, sentiment);
      const stats = computeThemeReactionStats(history);
      const draft = await buildPredictionDraft({ themeName, recentNewsSummaries: summaries, stats });
      draft.reasoning = `[해외 선행지표] ${draft.reasoning}`;
      await insertPrediction(supabase, themeId, draft);
      results.created++;

      if (exceedsPushThreshold(draft)) {
        await pushPredictionAlert(themeName, draft);
        results.pushed++;
      }
    } catch (err) {
      results.failures.push(`overseas:${themeName}: ${(err as Error).message}`);
    }
  }

  if (results.pushed === 0) {
    try {
      await pushNoNewsHeartbeat(supabase);
      results.heartbeat = true;
    } catch (err) {
      results.failures.push(`heartbeat: ${(err as Error).message}`);
    }
  }

  return results;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!requireCronSecret(req)) return res.status(401).json({ error: 'unauthorized' });

  try {
    const result = await run();
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
}
