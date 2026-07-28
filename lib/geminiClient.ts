import { GoogleGenAI } from '@google/genai';

let client: GoogleGenAI | null = null;

export function getGemini(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  return client;
}

// Pinned 2.5 model IDs got cut off for new API-key projects (404 "no longer
// available to new users") — rolling aliases stay valid across Google's
// version churn instead of needing another manual bump later.
export const TAGGING_MODEL = 'gemini-flash-lite-latest';
export const REASONING_MODEL = 'gemini-flash-latest';
