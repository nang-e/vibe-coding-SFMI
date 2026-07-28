import { Type, type Schema } from '@google/genai';
import { getGemini, TAGGING_MODEL } from './geminiClient';
import type { Theme } from './types';

export interface TagResult {
  themeName: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  confidence: number;
  reasoning: string;
}

const TAG_RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    tags: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          themeName: { type: Type.STRING },
          sentiment: { type: Type.STRING, format: 'enum', enum: ['positive', 'negative', 'neutral'] },
          confidence: { type: Type.NUMBER },
          reasoning: { type: Type.STRING },
        },
        required: ['themeName', 'sentiment', 'confidence', 'reasoning'],
      },
    },
  },
  required: ['tags'],
};

export async function tagNewsItem(
  item: { title: string; summary: string | null },
  themes: Theme[],
): Promise<TagResult[]> {
  const gemini = getGemini();
  const themeNames = themes.map((t) => t.name).join(', ');

  const response = await gemini.models.generateContent({
    model: TAGGING_MODEL,
    contents: `다음 뉴스와 관련 있는 테마를 아래 목록 중에서만 골라 태깅해줘. 관련 있는 테마가 없으면 빈 배열을 반환해.\n\n테마 목록: ${themeNames}\n\n제목: ${item.title}\n요약: ${item.summary ?? '(없음)'}`,
    config: {
      responseMimeType: 'application/json',
      responseSchema: TAG_RESPONSE_SCHEMA,
    },
  });

  if (!response.text) return [];
  const parsed = JSON.parse(response.text) as { tags: TagResult[] };
  return parsed.tags;
}
