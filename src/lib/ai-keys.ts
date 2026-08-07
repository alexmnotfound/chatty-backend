import { supabase } from './supabase.js';
import { decrypt } from './encryption.js';

type Provider = 'openai' | 'claude';

// Never falls back to a platform-owned env var key — every AI call is billed
// to the company that owns it. Resolution order: the bot's own key (if it
// matches the requested provider), then the company-level key for that
// provider, then null (caller must handle "not configured").
export async function resolveCompanyApiKey(
  companyId: string,
  bot: { ai_provider?: string | null; ai_api_key_enc?: string | null } | null | undefined,
  provider: Provider,
): Promise<string | null> {
  if (bot?.ai_provider === provider && bot.ai_api_key_enc) {
    return decrypt(bot.ai_api_key_enc);
  }

  const column = provider === 'openai' ? 'open_ai_api_key' : 'anthropic_api_key';
  const { data: cfg } = await supabase
    .from('company_config')
    .select(column)
    .eq('company_id', companyId)
    .maybeSingle();

  return (cfg as Record<string, string | null> | null)?.[column] ?? null;
}
