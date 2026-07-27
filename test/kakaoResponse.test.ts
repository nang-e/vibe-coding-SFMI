import { describe, it, expect } from 'vitest';
import { simpleTextResponse, callbackAckResponse } from '../lib/kakaoResponse';

describe('simpleTextResponse', () => {
  it('wraps text in the Kakao skill response shape', () => {
    expect(simpleTextResponse('안녕')).toEqual({
      version: '2.0',
      template: { outputs: [{ simpleText: { text: '안녕' } }] },
    });
  });
});

describe('callbackAckResponse', () => {
  it('marks useCallback true with a holding message', () => {
    expect(callbackAckResponse('분석 중이에요')).toEqual({
      version: '2.0',
      useCallback: true,
      data: { text: '분석 중이에요' },
    });
  });
});
