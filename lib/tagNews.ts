import { getClaude, TAGGING_MODEL } from './claudeClient';
import type { Theme } from './types';

export interface TagResult {
  themeName: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  confidence: number;
  reasoning: string;
}

const TAG_TOOL = {
  name: 'record_tags',
  description: '뉴스 기사와 관련된 테마와 그 영향(호재/악재/중립)을 기록한다.',
  input_schema: {
    type: 'object' as const,
    properties: {
      tags: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            themeName: { type: 'string' },
            sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] },
            confidence: { type: 'number' },
            reasoning: { type: 'string' },
          },
          required: ['themeName', 'sentiment', 'confidence', 'reasoning'],
        },
      },
    },
    required: ['tags'],
  },
};

export async function tagNewsItem(
  item: { title: string; summary: string | null },
  themes: Theme[],
): Promise<TagResult[]> {
  const claude = getClaude();
  const themeNames = themes.map((t) => t.name).join(', ');

  const response = await claude.messages.create({
    model: TAGGING_MODEL,
    max_tokens: 1024,
    tools: [TAG_TOOL],
    tool_choice: { type: 'tool', name: 'record_tags' },
    messages: [
      {
        role: 'user',
        content: `다음 뉴스와 관련 있는 테마를 아래 목록 중에서만 골라 태깅해줘. 관련 있는 테마가 없으면 빈 배열을 반환해.\n\n테마 목록: ${themeNames}\n\n제목: ${item.title}\n요약: ${item.summary ?? '(없음)'}`,
      },
    ],
  });

  const toolUse = response.content.find((c): c is any => c.type === 'tool_use');
  if (!toolUse) return [];
  return toolUse.input.tags as TagResult[];
}
