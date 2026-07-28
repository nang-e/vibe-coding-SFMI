import { describe, it, expect, vi } from 'vitest';
import { tagNewsItem } from '../lib/tagNews';
import { chatJSON } from '../lib/openrouterClient';

vi.mock('../lib/openrouterClient', () => ({
  chatJSON: vi.fn(),
}));

describe('tagNewsItem', () => {
  it('parses the JSON response text into tag results', async () => {
    (chatJSON as any).mockResolvedValue(
      JSON.stringify({
        tags: [
          { themeName: '반도체', sentiment: 'positive', confidence: 0.8, reasoning: 'D램 수요 증가는 반도체 업종에 호재' },
        ],
      }),
    );

    const result = await tagNewsItem(
      { title: 'SK하이닉스, D램 수요 증가 전망', summary: null },
      [{ id: 't1', name: '반도체' }, { id: 't2', name: '바이오' }],
    );

    expect(result).toEqual([
      { themeName: '반도체', sentiment: 'positive', confidence: 0.8, reasoning: 'D램 수요 증가는 반도체 업종에 호재' },
    ]);
    expect(chatJSON).toHaveBeenCalledWith(expect.stringContaining('SK하이닉스, D램 수요 증가 전망'));
  });

  it('returns an empty array when the LLM returns no content', async () => {
    (chatJSON as any).mockResolvedValue('');

    const result = await tagNewsItem({ title: '무관한 뉴스', summary: null }, [{ id: 't1', name: '반도체' }]);

    expect(result).toEqual([]);
  });
});
