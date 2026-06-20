import { Router, type Request } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { supabase } from "../lib/supabase.js";
import { requireAuth } from "../middleware/auth.js";

const JWT_SECRET: string = process.env.JWT_SECRET ?? "";
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET is not configured with a strong value");
}
export const authRouter = Router();

authRouter.get("/me", requireAuth, async (req, res) => {
  const m = (req as Request & { member: { id: string; email: string; name: string; role: string; enabled: boolean; companyId: string } }).member;
  res.json({
    member: { id: m.id, email: m.email, name: m.name, role: m.role, enabled: m.enabled, companyId: m.companyId },
  });
});

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Email y contraseña requeridos" });
    return;
  }

  // Authenticate via Supabase Auth
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (authError || !authData.user) {
    res.status(401).json({ error: "Credenciales incorrectas" });
    return;
  }

  // Look up member record by user_id
  const { data: member } = await supabase
    .from("company_members")
    .select("*")
    .eq("user_id", authData.user.id)
    .maybeSingle();

  if (!member) {
    res.status(401).json({ error: "Credenciales incorrectas" });
    return;
  }
  if (!member.enabled) {
    res.status(403).json({ error: "Tu cuenta está deshabilitada. Consultá a un administrador." });
    return;
  }

  // Check company is active
  const { data: company } = await supabase
    .from("companies")
    .select("active")
    .eq("id", member.company_id)
    .maybeSingle();
  if (!company?.active) {
    res.status(403).json({ error: "La empresa está deshabilitada. Consultá al administrador." });
    return;
  }

  const token = jwt.sign(
    { memberId: member.id, companyId: member.company_id, scope: "member" },
    JWT_SECRET,
    { expiresIn: "7d", algorithm: "HS256" }
  );
  res.json({
    token,
    member: {
      id: member.id,
      email: member.email,
      name: member.name,
      role: member.role,
      enabled: member.enabled,
      companyId: member.company_id,
    },
  });
});

// NOTE: Self-service registration is disabled. User creation flows through
// the admin-only POST /api/team endpoint. A bootstrap admin can be created
// via the seed script when no users exist.
authRouter.post("/register", (_req, res) => {
  res.status(403).json({
    error: "El registro público está deshabilitado. Contactá a un administrador.",
  });
});
