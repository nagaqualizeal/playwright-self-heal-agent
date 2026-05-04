import dotenv from 'dotenv';
dotenv.config();

import axios from 'axios';
import fs from 'fs';

// Load config
const config = JSON.parse(
  fs.readFileSync('.selfhealrc.json', 'utf-8')
);

export async function getLLMSuggestions(payload: any) {
  const provider = config.llmProvider;

  if (provider === 'openai') {
    return await callOpenAI(payload);
  }

  if (provider === 'claude') {
    return await callClaude(payload);
  }

  throw new Error(`Unsupported LLM provider: ${provider}`);
}

// ==================== OPENAI ====================

async function callOpenAI(payload: any) {
  try {
    console.log('🤖 Using OpenAI');

    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: config.openai.model,
        messages: [
          {
            role: 'user',
            content: buildPrompt(payload)
          }
        ],
        temperature: 0.2
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const text = response.data.choices[0].message.content;

   const cleaned = extractJSON(text);

   return JSON.parse(cleaned);

  } catch (e: any) {
    console.log('❌ OpenAI error:', e.response?.data || e.message);
    return [];
  }
}

// ==================== CLAUDE ====================

async function callClaude(payload: any) {
  try {
    console.log('🤖 Using Claude');

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: config.claude.model,
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: buildPrompt(payload)
          }
        ]
      },
      {
        headers: {
          'x-api-key': process.env.CLAUDE_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        }
      }
    );

    const text = response.data.content[0].text;

   const cleaned = extractJSON(text);

return JSON.parse(cleaned);

  } catch (e: any) {
    console.log('❌ Claude error:', e.response?.data || e.message);
    return [];
  }
}

function extractJSON(text: string): string {
  // Remove ```json ... ``` wrapper
  const match = text.match(/```json\s*([\s\S]*?)\s*```/);

  if (match) {
    return match[1];
  }

  // fallback: try raw JSON
  return text.trim();
}
// ==================== COMMON PROMPT ====================
function buildPrompt(payload: any) {
  return `
You are a Playwright locator expert.

FAILED LOCATOR:
${payload.failedLocator}

ERROR:
${payload.error}

DOM:
${payload.dom.slice(0, 2000)}

IMPORTANT:
- Identify the MOST relevant element matching the failed locator
- Do NOT always return login button
- Return the best matching element

Return ONLY JSON:
[
 { "locator": "...", "confidence": 0.9 }
]
`;
}