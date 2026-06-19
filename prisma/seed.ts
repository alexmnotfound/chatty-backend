import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs"; // used only for super_admins password hash

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const PASSWORD = "test1234";

async function upsertAuthUser(email: string, name: string): Promise<string> {
  const { data: existing } = await supabase
    .from("company_members")
    .select("user_id")
    .eq("email", email)
    .maybeSingle();
  if (existing) {
    console.log(`– Auth user ya existe: ${email}`);
    return existing.user_id;
  }

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name },
  });
  if (error) throw error;
  console.log(`✓ Auth user creado: ${email}`);
  return data.user.id;
}

async function main() {
  // 1. Super admin
  const { data: existingSA } = await supabase
    .from("super_admins")
    .select("id")
    .eq("email", "super@demo.com")
    .maybeSingle();
  if (!existingSA) {
    const hash = await bcrypt.hash(PASSWORD, 10);
    const { error } = await supabase.from("super_admins").insert({
      email: "super@demo.com",
      password: hash,
      name: "Super Admin",
    });
    if (error) throw error;
    console.log("✓ Super admin: super@demo.com");
  } else {
    console.log("– Super admin ya existe: super@demo.com");
  }

  // 2. Demo company
  let { data: company } = await supabase
    .from("companies")
    .select("*")
    .eq("slug", "demo")
    .maybeSingle();
  if (!company) {
    const { data: created, error } = await supabase
      .from("companies")
      .insert({ name: "Demo Company", slug: "demo", active: true })
      .select()
      .single();
    if (error) throw error;
    company = created;
    console.log("✓ Empresa demo creada:", company!.id);
  } else {
    console.log("– Empresa demo ya existe:", company.id);
  }

  // Ensure company_config exists
  const { data: existingCfg } = await supabase
    .from("company_config")
    .select("id")
    .eq("company_id", company!.id)
    .maybeSingle();
  if (!existingCfg) {
    await supabase.from("company_config").insert({ company_id: company!.id });
  }

  // 3. Company admin
  const adminId = await upsertAuthUser("admin@demo.com", "Admin Demo");
  const { data: existingAdmin } = await supabase
    .from("company_members")
    .select("id")
    .eq("company_id", company!.id)
    .eq("user_id", adminId)
    .maybeSingle();
  if (!existingAdmin) {
    await supabase.from("company_members").insert({
      company_id: company!.id,
      user_id: adminId,
      email: "admin@demo.com",
      name: "Admin Demo",
      role: "admin",
    });
    console.log("✓ CompanyMember admin: admin@demo.com");
  } else {
    console.log("– CompanyMember admin ya existe");
  }

  // 4. Company agent
  const agentId = await upsertAuthUser("agent@demo.com", "Agent Demo");
  const { data: existingAgent } = await supabase
    .from("company_members")
    .select("id")
    .eq("company_id", company!.id)
    .eq("user_id", agentId)
    .maybeSingle();
  if (!existingAgent) {
    await supabase.from("company_members").insert({
      company_id: company!.id,
      user_id: agentId,
      email: "agent@demo.com",
      name: "Agent Demo",
      role: "agent",
    });
    console.log("✓ CompanyMember agent: agent@demo.com");
  } else {
    console.log("– CompanyMember agent ya existe");
  }

  console.log("\nCredenciales (todos con password: test1234):");
  console.log("  super@demo.com  — Super Admin");
  console.log("  admin@demo.com    — Company Admin");
  console.log("  agent@demo.com    — Company Agent");
}

main()
  .then(() => {
    console.log("Seed completado.");
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
