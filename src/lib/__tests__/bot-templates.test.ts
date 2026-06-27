import { describe, it, expect } from 'vitest';
import { BOT_TEMPLATES } from '../bot-templates';
import { compileSystemPrompt } from '../prompt-compiler';

const company = {
  name: 'ACME',
  hours: 'Lun a Vie 9 a 18',
  address: 'Calle Falsa 123',
  services: 'Plomería',
  contact: 'wa.me/549...',
  catalog: 'Caño 1/2" — $1000',
};

describe('BOT_TEMPLATES', () => {
  it('has recepcionista and comercial templates', () => {
    const keys = BOT_TEMPLATES.map((t) => t.key).sort();
    expect(keys).toEqual(['comercial', 'recepcionista']);
  });

  it('every template uses the guide section structure', () => {
    for (const t of BOT_TEMPLATES) {
      expect(t.systemPrompt).toContain('# Rol y objetivo');
      expect(t.systemPrompt).toContain('# Instrucciones');
      expect(t.systemPrompt).toContain('# Formato de salida');
    }
  });

  it('comercial includes a Catálogo section with the catalogo variable', () => {
    const comercial = BOT_TEMPLATES.find((t) => t.key === 'comercial')!;
    expect(comercial.systemPrompt).toContain('# Catálogo');
    expect(comercial.systemPrompt).toContain('{{empresa.catalogo}}');
  });

  it('compiles each template with bot + company info leaving no unresolved variables', () => {
    for (const t of BOT_TEMPLATES) {
      const result = compileSystemPrompt(
        { name: 'Valentina', gender: 'feminine', systemPrompt: t.systemPrompt, examples: [] } as any,
        company,
      );
      expect(result).not.toMatch(/\{\{empresa\./);
      expect(result).not.toMatch(/\{\{bot\./);
      expect(result).toContain('ACME');
      expect(result).toContain('Valentina');
    }
  });

  it('renders the catalogo value in the comercial template', () => {
    const comercial = BOT_TEMPLATES.find((t) => t.key === 'comercial')!;
    const result = compileSystemPrompt({ systemPrompt: comercial.systemPrompt, examples: [] } as any, company);
    expect(result).toContain('Caño 1/2" — $1000');
  });
});
