import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  text: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
}

export async function getAIReply(
  provider: 'openai' | 'claude',
  apiKey: string,
  model: string,
  systemPrompt: string,
  history: ChatMessage[]
): Promise<AIResponse> {
  if (provider === 'openai') {
    const client = new OpenAI({ apiKey });
    const response = await client.chat.completions.create({
      model,
      messages: [{ role: 'system', content: systemPrompt }, ...history],
    });
    const choice = response.choices[0];
    return {
      text: choice.message.content ?? '',
      tokensIn: response.usage?.prompt_tokens ?? 0,
      tokensOut: response.usage?.completion_tokens ?? 0,
      model,
    };
  }

  if (provider === 'claude') {
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model,
      max_tokens: 1024,
      system: systemPrompt,
      messages: history,
    });
    const block = response.content[0];
    return {
      text: block.type === 'text' ? block.text : '',
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
      model,
    };
  }

  throw new Error(`Unknown AI provider: ${provider}`);
}
