import { chatJSON } from './openrouterClient';
import type { Theme } from './types';

export interface TagResult {
  themeName: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  confidence: number;
  reasoning: string;
}

export async function tagNewsItem(
  item: { title: string; summary: string | null },
  themes: Theme[],
): Promise<TagResult[]> {
  const themeNames = themes.map((t) => t.name).join(', ');

  const prompt = `다음 뉴스와 관련 있는 테마를 아래 목록 중에서만 골라 태깅해줘. 관련 있는 테마가 없으면 빈 배열을 반환해.\n\n테마 목록: ${themeNames}\n\n제목: ${item.title}\n요약: ${item.summary ?? '(없음)'}\n\n반드시 아래 형식의 JSON 객체 하나만 답해. 다른 설명이나 마크다운 코드블록 없이 JSON만 출력해:\n{"tags": [{"themeName": "테마명", "sentiment": "positive 또는 negative 또는 neutral", "confidence": 0~1 사이 숫자, "reasoning": "한국어 근거 문자열"}]}`;

  const content = await chatJSON(prompt);
  if (!content) return [];
  const parsed = JSON.parse(content) as { tags: TagResult[] };
  return parsed.tags;
}
