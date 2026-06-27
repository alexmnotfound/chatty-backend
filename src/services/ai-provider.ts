import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface AIResponse {
  text: string | null;
  tokensIn: number;
  tokensOut: number;
  model: string;
  toolCalls: ToolCall[];
}

export async function getAIReply(
  provider: 'openai' | 'claude',
  apiKey: string,
  model: string,
  systemPrompt: string,
  history: ChatMessage[],
  tools?: ToolDef[],
): Promise<AIResponse> {
  if (provider === 'openai') {
    const client = new OpenAI({ apiKey });
    let response;
    try {
      response = await client.chat.completions.create({
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...history],
        ...(tools && tools.length > 0 && {
          tools: tools.map((t) => ({
            type: 'function' as const,
            function: { name: t.name, description: t.description, parameters: t.parameters },
          })),
          tool_choice: 'auto',
        }),
      });
    } catch (err: unknown) {
      throw new Error(`OpenAI API error: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
    const choice = response.choices[0];
    if (!choice) throw new Error('OpenAI returned no choices');

    const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).map((tc) => ({
      name: tc.function.name,
      arguments: (() => {
        try { return JSON.parse(tc.function.arguments) as Record<string, unknown>; }
        catch { return {}; }
      })(),
    }));

    return {
      text: choice.message.content ?? null,
      tokensIn: response.usage?.prompt_tokens ?? 0,
      tokensOut: response.usage?.completion_tokens ?? 0,
      model,
      toolCalls,
    };
  }

  if (provider === 'claude') {
    const client = new Anthropic({ apiKey });
    let response;
    try {
      // max_tokens: MVP hardcoded; configurable per-bot in post-MVP
      response = await client.messages.create({
        model,
        max_tokens: 1024,
        system: systemPrompt,
        messages: history,
      });
    } catch (err: unknown) {
      throw new Error(`Anthropic API error: ${err instanceof Error ? err.message : 'unknown error'}`);
    }
    const block = response.content[0];
    if (!block) throw new Error('Claude returned no content blocks');
    return {
      text: block.type === 'text' ? block.text : '',
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
      model,
      toolCalls: [],
    };
  }

  throw new Error(`Unknown AI provider: ${provider}`);
}

export function buildHistoryFromMessages(
  rows: Array<{ direction: string; body: string }>,
): ChatMessage[] {
  return rows.map((r) => ({
    role: r.direction === 'in' ? 'user' : 'assistant',
    content: r.body,
  }));
}
