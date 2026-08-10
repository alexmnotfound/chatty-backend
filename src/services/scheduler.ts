import cron from 'node-cron';
import { supabase } from '../lib/supabase.js';
import { exportReceiptRow } from '../routes/receipts.js';
import type { ReceiptFields } from './receipt-extractor.js';

// coelsa_id excluded: legitimately absent on most receipts, requiring
// "alta" on it would wrongly block otherwise-complete receipts from
// auto-export. Same list as Comprobantes.tsx's manual bulk-export filter.
const HIGH_CONFIDENCE_FIELDS: Array<keyof ReceiptFields> = [
  'monto', 'fecha_operacion', 'concepto', 'referencia',
  'remitente', 'cuit_remitente', 'banco_remitente',
  'destinatario', 'cuit_destinatario', 'cbu_alias_destino', 'banco_destinatario',
];

function isHighConfidence(extracted: ReceiptFields): boolean {
  return HIGH_CONFIDENCE_FIELDS.every((key) => extracted[key]?.confidence === 'alta');
}

function isDue(config: {
  schedule_type: 'interval' | 'days';
  interval_hours: number;
  schedule_days: number[];
  schedule_time: string;
  last_auto_export_at: string | null;
}): boolean {
  const now = new Date();
  const last = config.last_auto_export_at ? new Date(config.last_auto_export_at) : null;

  if (config.schedule_type === 'interval') {
    if (!last) return true;
    const hoursSince = (now.getTime() - last.getTime()) / (1000 * 60 * 60);
    return hoursSince >= Math.max(1, config.interval_hours);
  }

  // schedule_type === 'days': due if today is a selected day, current time
  // is at/after schedule_time, and we haven't already run today.
  const dayIndex = (now.getDay() + 6) % 7; // JS Sun=0..Sat=6 -> Lun=0..Dom=6
  if (!config.schedule_days.includes(dayIndex)) return false;
  const [h, m] = config.schedule_time.split(':').map(Number);
  const scheduledToday = new Date(now);
  scheduledToday.setHours(h, m, 0, 0);
  if (now < scheduledToday) return false;
  if (last && last >= scheduledToday) return false;
  return true;
}

export async function runAutoExportForCompany(companyId: string): Promise<void> {
  const { data: config } = await supabase
    .from('sheets_config')
    .select('*')
    .eq('company_id', companyId)
    .eq('auto_export', true)
    .maybeSingle();
  if (!config) return;
  if (!isDue(config as any)) return;

  const { data: receipts } = await supabase
    .from('receipts')
    .select('*')
    .eq('company_id', companyId)
    .in('estado', ['pendiente', 'revisado']);

  for (const receipt of receipts ?? []) {
    if (!isHighConfidence(receipt.extracted)) continue;
    await exportReceiptRow(receipt, config, companyId);
  }

  await supabase.from('sheets_config').update({ last_auto_export_at: new Date().toISOString() }).eq('company_id', companyId);
}

export function initScheduler(): void {
  cron.schedule('*/15 * * * *', async () => {
    const { data: configs } = await supabase.from('sheets_config').select('company_id').eq('auto_export', true);
    for (const c of configs ?? []) {
      try {
        await runAutoExportForCompany(c.company_id);
      } catch (err) {
        console.error(`[scheduler] Auto-export failed for company ${c.company_id}:`, err);
      }
    }
  });
  console.log('[scheduler] Auto-export cron initialized (every 15 min)');
}
