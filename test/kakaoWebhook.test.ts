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
  waitUntil: (p: Promise<any>) => {
    capturedBackgroundPromises.push(p);
  },
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
      if (table === 'predictions')
        return chainable({
          data: [{ reasoning: '축산업 하락 가능', direction: 'down', range_low: -4, range_high: -2 }],
          error: null,
        });
      if (table === 'intraday_quotes') return chainable({ data: [], error: null });
      if (table === 'news_tags') return chainable({ data: [], error: null });
      return chainable({ data: [], error: null });
    });

    const fetchMock = vi.fn(async () => ({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    const req = {
      method: 'POST',
      body: {
        userRequest: {
          utterance: '실시간 흐름이랑 예상하락종목 알려줘',
          callbackUrl: 'https://bot-api.kakao.com/callback/abc',
        },
      },
    } as any;
    const json = vi.fn();
    const res = { status: vi.fn(() => ({ json })) } as any;

    await handler(req, res);

    // The handler must respond with the ack in the same tick, without waiting for Claude/Supabase.
    expect(res.status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({
      version: '2.0',
      useCallback: true,
      data: { text: '분석 중이에요, 잠시만 기다려주세요' },
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();

    await Promise.all(capturedBackgroundPromises);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe('https://bot-api.kakao.com/callback/abc');
    expect(options.method).toBe('POST');
    expect(options.headers).toEqual({ 'Content-Type': 'application/json' });

    const parsedBody = JSON.parse(options.body);
    expect(parsedBody).toEqual({
      version: '2.0',
      template: { outputs: [{ simpleText: { text: expect.stringContaining('투자 참고용') } }] },
    });
    expect(parsedBody.template.outputs[0].simpleText.text).toContain('지금 반도체 테마가 좋아요');
  });
});
