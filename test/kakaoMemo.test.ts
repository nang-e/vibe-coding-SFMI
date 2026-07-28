import { describe, it, expect, vi, beforeEach } from 'vitest';
import { sendKakaoMemo } from '../lib/kakaoMemo';

beforeEach(() => {
  process.env.KAKAO_REST_API_KEY = 'rest-key';
  process.env.KAKAO_CLIENT_SECRET = 'client-secret';
  process.env.KAKAO_REFRESH_TOKEN = 'refresh-token';
});

describe('sendKakaoMemo', () => {
  it('refreshes an access token, then sends the memo with it', async () => {
    const fetchMock = vi.fn(async (url: string, init?: any) => {
      if (url === 'https://kauth.kakao.com/oauth/token') {
        expect(init.body).toContain('grant_type=refresh_token');
        expect(init.body).toContain('refresh_token=refresh-token');
        return { ok: true, json: async () => ({ access_token: 'fresh-token' }) };
      }
      if (url === 'https://kapi.kakao.com/v2/api/talk/memo/default/send') {
        expect(init.headers.Authorization).toBe('Bearer fresh-token');
        const parsed = new URLSearchParams(init.body);
        const templateObject = JSON.parse(parsed.get('template_object')!);
        expect(templateObject.text).toBe('테스트 메시지');
        return { ok: true, json: async () => ({ result_code: 0 }) };
      }
      throw new Error(`unexpected fetch to ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await sendKakaoMemo('테스트 메시지');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws if the token refresh fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401 })));
    await expect(sendKakaoMemo('메시지')).rejects.toThrow('Kakao token refresh failed');
  });
});
