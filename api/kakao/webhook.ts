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
