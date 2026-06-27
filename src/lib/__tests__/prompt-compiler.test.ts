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

  it('resolves {{bot.nombre}} and {{bot.articulo}} from bot fields', () => {
    const bot = {
      name: 'Valentina',
      gender: 'feminine',
      systemPrompt: 'Sos {{bot.articulo}} recepcionista. Me llamo {{bot.nombre}}.',
      examples: [],
    };
    const result = compileSystemPrompt(bot as any);
    expect(result).toContain('Sos la recepcionista');
    expect(result).toContain('Me llamo Valentina');
    expect(result).not.toContain('{{bot.');
  });

  it('resolves {{bot.articulo}} for each gender', () => {
    const make = (gender: string) =>
      compileSystemPrompt({ systemPrompt: '{{bot.articulo}}', gender, examples: [] } as any);
    expect(make('masculine')).toContain('el');
    expect(make('feminine')).toContain('la');
    expect(make('non_binary')).toContain('le');
    expect(make('neutral')).toContain('el/la');
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
    expect(result).toContain('Catálogo: ');
  });

  it('resolves empresa variables to empty string when no company is passed', () => {
    const bot = { systemPrompt: 'Hola {{empresa.nombre}} {{empresa.catalogo}}', examples: [] };
    const result = compileSystemPrompt(bot as any);
    expect(result).not.toMatch(/\{\{empresa\./);
  });

  it('omits horario section when businessHoursEnabled is false/undefined', () => {
    const result = compileSystemPrompt({ system_prompt: 'Sos un bot.' });
    expect(result).not.toContain('## Horario de atención');
  });

  it('injects ## Horario de atención when businessHoursEnabled is true', () => {
    const result = compileSystemPrompt(
      { system_prompt: 'Sos un bot.', businessHoursEnabled: true },
    );
    expect(result).toContain('## Horario de atención');
    expect(result).toContain('fuera del horario');
    const horarionPos = result.indexOf('## Horario de atención');
    const fechaPos = result.indexOf('## Fecha y hora');
    expect(horarionPos).toBeLessThan(fechaPos);
  });

  it('always injects ## Derivación a humano section', () => {
    const result = compileSystemPrompt({ system_prompt: 'Sos un bot.' });
    expect(result).toContain('## Derivación a humano');
    expect(result).toContain('solicitar_handoff');
    expect(result).toContain('nuestro equipo');
  });

  it('uses handoffTeam when provided', () => {
    const result = compileSystemPrompt({
      system_prompt: 'Sos un bot.',
      handoffTeam: 'el equipo de ventas',
    });
    expect(result).toContain('el equipo de ventas');
    expect(result).not.toContain('nuestro equipo');
  });
});
