// "나에게 보내기" push notifications. Access tokens expire in ~6h and this
// runs across stateless serverless invocations, so every send refreshes a
// fresh access token from the stored refresh token rather than trying to
// cache/track expiry across invocations.

async function refreshAccessToken(): Promise<string> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: process.env.KAKAO_REST_API_KEY!,
    client_secret: process.env.KAKAO_CLIENT_SECRET!,
    refresh_token: process.env.KAKAO_REFRESH_TOKEN!,
  });
  const res = await fetch('https://kauth.kakao.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Kakao token refresh failed: ${res.status}`);
  const body = await res.json();
  return body.access_token as string;
}

export async function sendKakaoMemo(text: string): Promise<void> {
  const accessToken = await refreshAccessToken();
  const params = new URLSearchParams({
    template_object: JSON.stringify({
      object_type: 'text',
      text,
      link: {
        web_url: 'https://ai-stock-kakao-assistant-mvp.vercel.app',
        mobile_web_url: 'https://ai-stock-kakao-assistant-mvp.vercel.app',
      },
    }),
  });
  const res = await fetch('https://kapi.kakao.com/v2/api/talk/memo/default/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });
  if (!res.ok) throw new Error(`Kakao memo send failed: ${res.status}`);
}
