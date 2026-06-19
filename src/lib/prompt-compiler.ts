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

type BotLike = {
  system_prompt?: string;
  systemPrompt?: string;
  gender?: string | null;
  tone?: string | null;
  examples?: Array<{ user_message?: string; userMessage?: string; bot_response?: string; botResponse?: string; order: number }>;
};

export function compileSystemPrompt(bot: BotLike): string {
  const parts: string[] = [];

  parts.push(bot.system_prompt ?? bot.systemPrompt ?? '');

  const gender = bot.gender ? GENDER_LABEL[bot.gender] ?? bot.gender : null;
  const tone = bot.tone ? TONE_LABEL[bot.tone] ?? bot.tone : null;
  if (gender || tone) {
    const traits = [gender, tone].filter(Boolean).join(', ');
    parts.push(`\nPersonalidad: ${traits}`);
  }

  const examples = bot.examples ?? [];
  const sorted = [...examples].sort((a, b) => a.order - b.order);
  if (sorted.length > 0) {
    parts.push('\nEjemplos de conversación:');
    for (const ex of sorted) {
      parts.push(`Usuario: "${ex.user_message ?? ex.userMessage}"`);
      parts.push(`Vos: "${ex.bot_response ?? ex.botResponse}"`);
    }
  }

  const now = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  parts.push(`\nFecha y hora actual: ${now}`);

  return parts.join('\n');
}
