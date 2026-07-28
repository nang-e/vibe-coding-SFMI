// OpenRouter (https://openrouter.ai) replaces Gemini as the LLM provider —
// Gemini's free-tier daily quota (20 requests/day/model) was getting
// exhausted by real traffic. OpenRouter's free-tier models pool is used
// instead via a single shared OpenAI-compatible chat completions endpoint.
export class OpenRouterError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

// Picked from the live :free model list (openrouter.ai/api/v1/models).
// openai/gpt-oss-20b:free was tried first but is a reasoning model that
// burns 100+ reasoning tokens per call (10-15s each) — with up to 20
// sequential tag calls plus prediction calls, that blew through even a
// 300s function budget. This one answers directly with 0 reasoning
// tokens (~3s per call), verified via direct test calls before switching.
export const MODEL_NAME = 'google/gemma-4-26b-a4b-it:free';

async function chat(prompt: string, jsonMode: boolean): Promise<string> {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL_NAME,
      messages: [{ role: 'user', content: prompt }],
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    }),
  });
  if (!res.ok) {
    throw new OpenRouterError(`OpenRouter request failed: ${res.status}`, res.status);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '';
}

export function chatText(prompt: string): Promise<string> {
  return chat(prompt, false);
}

export function chatJSON(prompt: string): Promise<string> {
  return chat(prompt, true);
}
