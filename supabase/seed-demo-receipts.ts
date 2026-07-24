import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

type FieldValue = { value: string | null; confidence: "alta" | "media" | "baja" };
type ReceiptFields = {
  monto: FieldValue;
  fecha_operacion: FieldValue;
  banco_origen: FieldValue;
  remitente: FieldValue;
  cuit: FieldValue;
  cbu_alias: FieldValue;
  referencia: FieldValue;
  concepto: FieldValue;
};

const EMPTY_FIELDS: ReceiptFields = {
  monto: { value: null, confidence: "baja" },
  fecha_operacion: { value: null, confidence: "baja" },
  banco_origen: { value: null, confidence: "baja" },
  remitente: { value: null, confidence: "baja" },
  cuit: { value: null, confidence: "baja" },
  cbu_alias: { value: null, confidence: "baja" },
  referencia: { value: null, confidence: "baja" },
  concepto: { value: null, confidence: "baja" },
};

// Filenames match the "[PDF:...]"/"[IMAGEN:...]" placeholder messages already
// seeded in seed-demo.ts for these same contacts, so the inbox thread and the
// Comprobantes review queue tell the same story. All use application/pdf so
// the Extractor preview always shows a clean "Abrir PDF" link instead of a
// broken <img> — no real file exists in Storage for these demo rows.
const DEMO_RECEIPTS: Array<{
  waId: string;
  messageIdSuffix: string;
  filename: string;
  estado: "pendiente" | "revisado" | "exportado" | "error";
  extracted: ReceiptFields;
  exportedDaysAgo?: number;
}> = [
  {
    waId: "5491211223344", // Valeria Torres
    messageIdSuffix: "valeria-galicia",
    filename: "comprobante-transferencia-galicia.pdf",
    estado: "pendiente",
    extracted: {
      monto: { value: "$45.000,00", confidence: "alta" },
      fecha_operacion: { value: "25/04/2026", confidence: "alta" },
      banco_origen: { value: "Banco Galicia", confidence: "alta" },
      remitente: { value: "Valeria Torres", confidence: "alta" },
      cuit: { value: "27-31847265-4", confidence: "media" },
      cbu_alias: { value: "0170099340000012345678", confidence: "alta" },
      referencia: { value: "00923841", confidence: "alta" },
      concepto: { value: "Varios", confidence: "media" },
    },
  },
  {
    waId: "5491211223344", // Valeria Torres
    messageIdSuffix: "valeria-marzo",
    filename: "pago-marzo-valeria.pdf",
    estado: "pendiente",
    extracted: {
      monto: { value: "$38.500,00", confidence: "media" },
      fecha_operacion: { value: "28/03/2026", confidence: "baja" },
      banco_origen: { value: null, confidence: "baja" },
      remitente: { value: "Valeria Torres", confidence: "media" },
      cuit: { value: null, confidence: "baja" },
      cbu_alias: { value: null, confidence: "baja" },
      referencia: { value: "00887213", confidence: "media" },
      concepto: { value: null, confidence: "baja" },
    },
  },
  {
    waId: "5491222334455", // Hernán Bravo
    messageIdSuffix: "hernan-lunes",
    filename: "transferencia-lunes.pdf",
    estado: "revisado",
    extracted: {
      monto: { value: "$12.500,00", confidence: "alta" },
      fecha_operacion: { value: "21/04/2026", confidence: "alta" },
      banco_origen: { value: "BBVA", confidence: "alta" },
      remitente: { value: "Hernán Bravo", confidence: "media" },
      cuit: { value: "20-28491023-7", confidence: "baja" },
      cbu_alias: { value: null, confidence: "baja" },
      referencia: { value: "00847261", confidence: "alta" },
      concepto: { value: "Servicios", confidence: "media" },
    },
  },
  {
    waId: "5491222334455", // Hernán Bravo
    messageIdSuffix: "hernan-miercoles",
    filename: "transferencia-miercoles.pdf",
    estado: "revisado",
    extracted: {
      monto: { value: "$8.300,00", confidence: "alta" },
      fecha_operacion: { value: "23/04/2026", confidence: "alta" },
      banco_origen: { value: "Santander", confidence: "alta" },
      remitente: { value: "Hernán Bravo", confidence: "alta" },
      cuit: { value: null, confidence: "baja" },
      cbu_alias: { value: null, confidence: "baja" },
      referencia: { value: "00851034", confidence: "alta" },
      concepto: { value: "Honorarios", confidence: "media" },
    },
  },
  {
    waId: "5491222334455", // Hernán Bravo
    messageIdSuffix: "hernan-factura",
    filename: "factura-abril.pdf",
    estado: "error",
    extracted: EMPTY_FIELDS,
  },
  {
    waId: "5491233445566", // Cecilia Ríos
    messageIdSuffix: "cecilia-marzo",
    filename: "pago-marzo-2026.pdf",
    estado: "exportado",
    exportedDaysAgo: 2,
    extracted: {
      monto: { value: "$32.000,00", confidence: "alta" },
      fecha_operacion: { value: "31/03/2026", confidence: "alta" },
      banco_origen: { value: "Banco Nación", confidence: "alta" },
      remitente: { value: "Cecilia Ríos", confidence: "alta" },
      cuit: { value: "27-30112456-9", confidence: "alta" },
      cbu_alias: { value: "cecilia.rios.mp", confidence: "media" },
      referencia: { value: "00779654", confidence: "alta" },
      concepto: { value: "Pago mensual", confidence: "alta" },
    },
  },
  {
    waId: "5491277889900", // Nicolás Herrera
    messageIdSuffix: "nicolas-sena",
    filename: "transferencia-sena-nicolas.pdf",
    estado: "pendiente",
    extracted: {
      monto: { value: "$60.000,00", confidence: "media" },
      fecha_operacion: { value: "13/07/2026", confidence: "media" },
      banco_origen: { value: "Mercado Pago", confidence: "media" },
      remitente: { value: "Nicolás Herrera", confidence: "alta" },
      cuit: { value: null, confidence: "baja" },
      cbu_alias: { value: "nicolas.herrera.mp", confidence: "media" },
      referencia: { value: null, confidence: "baja" },
      concepto: { value: "Seña", confidence: "media" },
    },
  },
];

async function main() {
  const { data: company } = await supabase
    .from("companies")
    .select("*")
    .eq("slug", "demo")
    .maybeSingle();
  if (!company) {
    console.error("Empresa demo no encontrada. Ejecutá primero: npm run db:seed");
    process.exit(1);
  }

  const now = new Date();

  for (const r of DEMO_RECEIPTS) {
    const messageId = `demo-seed-${r.messageIdSuffix}`;

    const { data: existing } = await supabase
      .from("receipts")
      .select("id")
      .eq("company_id", company.id)
      .eq("message_id", messageId)
      .maybeSingle();
    if (existing) {
      console.log(`Comprobante ya existe: ${r.filename}`);
      continue;
    }

    const { data: contact } = await supabase
      .from("contacts")
      .select("id")
      .eq("company_id", company.id)
      .eq("wa_id", r.waId)
      .maybeSingle();
    if (!contact) {
      console.error(`Contacto no encontrado para wa_id ${r.waId} — ejecutá primero seed-demo.ts`);
      continue;
    }

    const { data: conversation } = await supabase
      .from("conversations")
      .select("id")
      .eq("company_id", company.id)
      .eq("contact_id", contact.id)
      .maybeSingle();
    if (!conversation) {
      console.error(`Conversación no encontrada para contacto ${r.waId}`);
      continue;
    }

    const { error } = await supabase.from("receipts").insert({
      company_id: company.id,
      conversation_id: conversation.id,
      message_id: messageId,
      storage_path: `${company.id}/demo-${r.messageIdSuffix}.pdf`,
      mime_type: "application/pdf",
      estado: r.estado,
      extracted: r.extracted,
      exported_at: r.exportedDaysAgo
        ? new Date(now.getTime() - r.exportedDaysAgo * 24 * 60 * 60 * 1000).toISOString()
        : null,
    });
    if (error) {
      console.error(`Error insertando comprobante ${r.filename}:`, error);
      continue;
    }
    console.log(`Creado: ${r.filename} — ${r.estado}`);
  }

  console.log("\nSeed de comprobantes demo completado.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
