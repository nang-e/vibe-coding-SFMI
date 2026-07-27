import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | null = null;

export function getClaude(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  return client;
}

export const TAGGING_MODEL = 'claude-haiku-4-5-20251001';
export const REASONING_MODEL = 'claude-sonnet-5';
