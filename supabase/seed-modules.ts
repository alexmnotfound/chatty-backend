import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const MODULES = [
  { slug: "bots", name: "Bots", description: "Asistentes de IA configurables", price_usd: 0, active: true },
  { slug: "comprobantes", name: "Comprobantes", description: "Extracción de comprobantes de pago", price_usd: 0, active: true },
  { slug: "sheets", name: "Google Sheets", description: "Exportación de datos a Google Sheets", price_usd: 0, active: true },
  { slug: "observability", name: "Observabilidad", description: "Métricas de consumo de IA", price_usd: 0, active: true },
];

async function main() {
  const { data: company } = await supabase.from("companies").select("id").eq("slug", "demo").maybeSingle();
  if (!company) {
    console.error("Empresa demo no encontrada. Ejecutá primero: npm run db:seed");
    process.exit(1);
  }

  for (const m of MODULES) {
    const { data: existing } = await supabase.from("plugins").select("id").eq("slug", m.slug).maybeSingle();
    let pluginId = existing?.id as string | undefined;

    if (!existing) {
      const { data: created, error } = await supabase.from("plugins").insert(m).select("id").single();
      if (error || !created) {
        console.error(`Error creando plugin ${m.slug}:`, error);
        continue;
      }
      pluginId = created.id;
      console.log(`Plugin creado: ${m.name}`);
    } else {
      console.log(`Plugin ya existe: ${m.name}`);
    }

    const { data: assignment } = await supabase
      .from("company_plugins")
      .select("id")
      .eq("company_id", company.id)
      .eq("plugin_id", pluginId)
      .maybeSingle();

    if (!assignment) {
      const { error } = await supabase.from("company_plugins").insert({ company_id: company.id, plugin_id: pluginId });
      if (error) console.error(`Error asignando ${m.name} a la empresa demo:`, error);
      else console.log(`  ↳ asignado a la empresa demo`);
    } else {
      console.log(`  ↳ ya estaba asignado a la empresa demo`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
