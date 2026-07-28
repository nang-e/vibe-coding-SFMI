import { describe, it, expect, vi } from 'vitest';
import { Type } from '@google/genai';
import { tagNewsItem } from '../lib/tagNews';
import { getGemini } from '../lib/geminiClient';

vi.mock('../lib/geminiClient', () => ({
  getGemini: vi.fn(),
  TAGGING_MODEL: 'gemini-2.5-flash-lite',
}));

describe('tagNewsItem', () => {
  it('parses the JSON response text into tag results', async () => {
    // Gemini's GenerateContentResponse exposes a `.text` getter holding the
    // JSON string when responseMimeType: 'application/json' is used.
    const mockGenerateContent = vi.fn(async () => ({
      text: JSON.stringify({
        tags: [
          { themeName: '반도체', sentiment: 'positive', confidence: 0.8, reasoning: 'D램 수요 증가는 반도체 업종에 호재' },
        ],
      }),
    }));
    (getGemini as any).mockReturnValue({ models: { generateContent: mockGenerateContent } });

    const result = await tagNewsItem(
      { title: 'SK하이닉스, D램 수요 증가 전망', summary: null },
      [{ id: 't1', name: '반도체' }, { id: 't2', name: '바이오' }],
    );

    expect(result).toEqual([
      { themeName: '반도체', sentiment: 'positive', confidence: 0.8, reasoning: 'D램 수요 증가는 반도체 업종에 호재' },
    ]);
    expect(mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-2.5-flash-lite',
        contents: expect.stringContaining('SK하이닉스, D램 수요 증가 전망'),
        config: expect.objectContaining({
          responseMimeType: 'application/json',
          responseSchema: expect.objectContaining({
            type: Type.OBJECT,
            required: ['tags'],
            properties: expect.objectContaining({
              tags: expect.objectContaining({ type: Type.ARRAY }),
            }),
          }),
        }),
      }),
    );
  });
});
