import { describe, it, expect } from 'vitest';
import { compileSystemPrompt } from '../prompt-compiler';

const baseBot = {
  systemPrompt: 'Sos una recepcionista virtual.',
  gender: 'feminine',
  tone: 'informal',
  examples: [],
};

describe('compileSystemPrompt', () => {
  it('includes system prompt and personality', () => {
    const result = compileSystemPrompt(baseBot as any);
    expect(result).toContain('Sos una recepcionista virtual.');
    expect(result).toContain('femenino');
    expect(result).toContain('informal');
  });

  it('includes examples as few-shot when provided', () => {
    const bot = {
      ...baseBot,
      examples: [
        { userMessage: 'hola', botResponse: 'hola! cómo te puedo ayudar?', order: 0 },
      ],
    };
    const result = compileSystemPrompt(bot as any);
    expect(result).toContain('hola');
    expect(result).toContain('hola! cómo te puedo ayudar?');
  });

  it('sorts examples by order field', () => {
    const bot = {
      ...baseBot,
      examples: [
        { userMessage: 'b', botResponse: 'B', order: 1 },
        { userMessage: 'a', botResponse: 'A', order: 0 },
      ],
    };
    const result = compileSystemPrompt(bot as any);
    expect(result.indexOf('"a"')).toBeLessThan(result.indexOf('"b"'));
  });

  it('includes current date/time', () => {
    const result = compileSystemPrompt(baseBot as any);
    expect(result).toContain('Fecha y hora actual:');
  });

  it('works with no examples', () => {
    const result = compileSystemPrompt(baseBot as any);
    expect(result).not.toContain('Ejemplos de conversación');
  });
});
