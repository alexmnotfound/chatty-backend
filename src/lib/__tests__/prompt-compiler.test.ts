import { describe, it, expect } from 'vitest';
import { compileSystemPrompt } from '../prompt-compiler';

const baseBot = {
  systemPrompt: 'Sos una recepcionista virtual.',
  gender: 'feminine',
  tone: 'informal',
  examples: [],
};

describe('compileSystemPrompt', () => {
  it('includes system prompt and personality section', () => {
    const result = compileSystemPrompt(baseBot as any);
    expect(result).toContain('Sos una recepcionista virtual.');
    expect(result).toContain('## Personalidad');
    expect(result).toContain('femenino');
    expect(result).toContain('informal');
  });

  it('includes examples under markdown section with anti-copy note', () => {
    const bot = {
      ...baseBot,
      examples: [
        { userMessage: 'hola', botResponse: 'hola! cómo te puedo ayudar?', order: 0 },
      ],
    };
    const result = compileSystemPrompt(bot as any);
    expect(result).toContain('## Ejemplos');
    expect(result).toContain('no los copies textual');
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

  it('includes current date/time section', () => {
    const result = compileSystemPrompt(baseBot as any);
    expect(result).toContain('## Fecha y hora');
  });

  it('works with no examples', () => {
    const result = compileSystemPrompt(baseBot as any);
    expect(result).not.toContain('## Ejemplos');
  });

  it('resolves the catalogo variable from company.catalog', () => {
    const bot = { systemPrompt: 'Catálogo: {{empresa.catalogo}}', examples: [] };
    const result = compileSystemPrompt(bot as any, { catalog: 'Producto X' });
    expect(result).toContain('Catálogo: Producto X');
    expect(result).not.toContain('{{empresa.catalogo}}');
  });

  it('resolves catalogo to empty string when not provided', () => {
    const bot = { systemPrompt: 'Catálogo: {{empresa.catalogo}}', examples: [] };
    const result = compileSystemPrompt(bot as any, { name: 'ACME' });
    expect(result).not.toContain('{{empresa.catalogo}}');
  });
});
