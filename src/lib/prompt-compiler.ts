import type { Bot, BotExample } from '@prisma/client';

const GENDER_LABEL: Record<string, string> = {
  masculine: 'masculino',
  feminine: 'femenino',
  non_binary: 'no binario',
  neutral: 'neutral',
};

const TONE_LABEL: Record<string, string> = {
  formal: 'formal',
  informal: 'informal',
};

type BotWithExamples = Bot & { examples: BotExample[] };

export function compileSystemPrompt(bot: BotWithExamples): string {
  const parts: string[] = [];

  parts.push(bot.systemPrompt);

  const gender = bot.gender ? GENDER_LABEL[bot.gender] ?? bot.gender : null;
  const tone = bot.tone ? TONE_LABEL[bot.tone] ?? bot.tone : null;
  if (gender || tone) {
    const traits = [gender, tone].filter(Boolean).join(', ');
    parts.push(`\nPersonalidad: ${traits}`);
  }

  const sorted = [...bot.examples].sort((a, b) => a.order - b.order);
  if (sorted.length > 0) {
    parts.push('\nEjemplos de conversación:');
    for (const ex of sorted) {
      parts.push(`Usuario: "${ex.userMessage}"`);
      parts.push(`Vos: "${ex.botResponse}"`);
    }
  }

  const now = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  parts.push(`\nFecha y hora actual: ${now}`);

  return parts.join('\n');
}
