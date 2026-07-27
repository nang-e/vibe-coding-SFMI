export interface KakaoResponse {
  version: '2.0';
  template?: { outputs: [{ simpleText: { text: string } }] };
  useCallback?: boolean;
  data?: { text: string };
}

const DISCLAIMER = '\n\n(투자 참고용이며 투자 판단과 책임은 본인에게 있습니다)';

export function simpleTextResponse(text: string, withDisclaimer = false): KakaoResponse {
  return {
    version: '2.0',
    template: { outputs: [{ simpleText: { text: withDisclaimer ? text + DISCLAIMER : text } }] },
  };
}

export function callbackAckResponse(text: string): KakaoResponse {
  return { version: '2.0', useCallback: true, data: { text } };
}
