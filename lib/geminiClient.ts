import { GoogleGenAI } from '@google/genai';

let client: GoogleGenAI | null = null;

export function getGemini(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  return client;
}

export const TAGGING_MODEL = 'gemini-2.5-flash-lite';
export const REASONING_MODEL = 'gemini-2.5-flash';
