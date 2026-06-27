const GENDER_LABEL: Record<string, string> = {
  masculine: 'masculino',
  feminine: 'femenino',
  non_binary: 'no binario',
  neutral: 'neutral',
};

const ARTICLE_LABEL: Record<string, string> = {
  masculine: 'el',
  feminine: 'la',
  non_binary: 'le',
  neutral: 'el/la',
};

const TONE_LABEL: Record<string, string> = {
  formal: 'formal',
  informal: 'informal',
};

const MAX_LENGTH_LABEL: Record<string, string> = {
  short: 'corta (~60 palabras)',
  medium: 'media (~120 palabras)',
  long: 'larga (~250 palabras)',
};

export type CompanyInfo = {
  name?: string | null;
  hours?: string | null;
  address?: string | null;
  services?: string | null;
  contact?: string | null;
  catalog?: string | null;
};

type BotLike = {
  name?: string | null;
  system_prompt?: string;
  systemPrompt?: string;
  gender?: string | null;
  tone?: string | null;
  max_length?: string | null;
  maxLength?: string | null;
  examples?: Array<{ user_message?: string; userMessage?: string; bot_response?: string; botResponse?: string; order: number }>;
  ragContext?: string[];
  businessHoursEnabled?: boolean;
};

export function compileSystemPrompt(bot: BotLike, company?: CompanyInfo): string {
  const parts: string[] = [];

  // Resolve {{empresa.*}} template variables before pushing
  const article = bot.gender ? ARTICLE_LABEL[bot.gender] ?? '' : '';

  let base = bot.system_prompt ?? bot.systemPrompt ?? '';
  base = base
    .replace(/\{\{bot\.nombre\}\}/g, bot.name ?? '')
    .replace(/\{\{bot\.articulo\}\}/g, article)
    .replace(/\{\{empresa\.nombre\}\}/g, company?.name ?? '')
    .replace(/\{\{empresa\.horarios\}\}/g, company?.hours ?? '')
    .replace(/\{\{empresa\.direccion\}\}/g, company?.address ?? '')
    .replace(/\{\{empresa\.servicios\}\}/g, company?.services ?? '')
    .replace(/\{\{empresa\.contacto\}\}/g, company?.contact ?? '')
    .replace(/\{\{empresa\.catalogo\}\}/g, company?.catalog ?? '');
  parts.push(base);

  const gender = bot.gender ? GENDER_LABEL[bot.gender] ?? bot.gender : null;
  const tone = bot.tone ? TONE_LABEL[bot.tone] ?? bot.tone : null;
  if (gender || tone) {
    const traits = [gender, tone].filter(Boolean).join(', ');
    parts.push(`\n## Personalidad\n${traits}`);
  }

  const maxLength = bot.max_length ?? bot.maxLength;
  if (maxLength && MAX_LENGTH_LABEL[maxLength]) {
    parts.push(`\n## Longitud de respuesta\n${MAX_LENGTH_LABEL[maxLength]}`);
  }

  const examples = bot.examples ?? [];
  const sorted = [...examples].sort((a, b) => a.order - b.order);
  if (sorted.length > 0) {
    parts.push('\n## Ejemplos');
    parts.push('Usá estos ejemplos como referencia de estilo; no los copies textual.');
    for (const ex of sorted) {
      parts.push(`Usuario: "${ex.user_message ?? ex.userMessage}"`);
      parts.push(`Vos: "${ex.bot_response ?? ex.botResponse}"`);
    }
  }

  if (bot.ragContext && bot.ragContext.length > 0) {
    parts.push('\n## Información de referencia');
    parts.push('Usá estos fragmentos si son relevantes para responder:');
    for (const chunk of bot.ragContext) {
      parts.push(`\n---\n${chunk}`);
    }
  }

  if (bot.businessHoursEnabled) {
    parts.push(
      '\n## Horario de atención\n' +
      'Si la hora actual (ver ## Fecha y hora) está fuera del horario indicado en # Contexto, ' +
      'informá al cliente que el negocio está cerrado y que puede contactarse en el próximo ' +
      'horario de atención. No proceses la consulta principal fuera de horario.'
    );
  }

  const now = new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });
  parts.push(`\n## Fecha y hora\n${now}`);

  return parts.join('\n');
}
