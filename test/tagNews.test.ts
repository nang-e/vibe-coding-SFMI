import { describe, it, expect, vi } from 'vitest';
import { tagNewsItem } from '../lib/tagNews';
import { getClaude } from '../lib/claudeClient';

vi.mock('../lib/claudeClient', () => ({
  getClaude: vi.fn(),
  TAGGING_MODEL: 'claude-haiku-4-5-20251001',
}));

describe('tagNewsItem', () => {
  it('parses the tool_use block into tag results', async () => {
    const mockCreate = vi.fn(async () => ({
      content: [
        {
          type: 'tool_use',
          input: {
            tags: [
              { themeName: '반도체', sentiment: 'positive', confidence: 0.8, reasoning: 'D램 수요 증가는 반도체 업종에 호재' },
            ],
          },
        },
      ],
    }));
    (getClaude as any).mockReturnValue({ messages: { create: mockCreate } });

    const result = await tagNewsItem(
      { title: 'SK하이닉스, D램 수요 증가 전망', summary: null },
      [{ id: 't1', name: '반도체' }, { id: 't2', name: '바이오' }],
    );

    expect(result).toEqual([
      { themeName: '반도체', sentiment: 'positive', confidence: 0.8, reasoning: 'D램 수요 증가는 반도체 업종에 호재' },
    ]);
    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ model: 'claude-haiku-4-5-20251001' }));
  });
});
