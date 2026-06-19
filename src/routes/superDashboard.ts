import { Router } from "express";
import { supabase } from "../lib/supabase.js";
import { requireSuperAuth } from "../middleware/superAuth.js";

export const superDashboardRouter = Router();
superDashboardRouter.use(requireSuperAuth);

superDashboardRouter.get("/", async (_req, res) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayIso = todayStart.toISOString();

  try {
    const [
      companiesActiveResult,
      usersTotalResult,
      conversationsTodayResult,
      messagesTodayResult,
      recentCompaniesResult,
      recentActivityResult,
      pluginAssignmentsResult,
    ] = await Promise.all([
      supabase.from("companies").select("id", { count: "exact", head: true }).eq("active", true),
      supabase.from("company_members").select("id", { count: "exact", head: true }),
      supabase.from("conversations").select("id", { count: "exact", head: true }).gte("created_at", todayIso),
      supabase.from("messages").select("id", { count: "exact", head: true }).gte("created_at", todayIso),
      supabase.from("companies").select("id, name, slug, active, created_at").order("created_at", { ascending: false }).limit(5),
      supabase.from("conversations").select("id, created_at, contacts(name, wa_id), companies(name, slug, id)").order("created_at", { ascending: false }).limit(10),
      supabase.from("company_plugins").select("plugin_id, plugins(name, icon)"),
    ]);

    const companiesActive = companiesActiveResult.count ?? 0;
    const usersTotal = usersTotalResult.count ?? 0;
    let conversationsToday = conversationsTodayResult.count ?? 0;
    let messagesToday = messagesTodayResult.count ?? 0;

    // Fallback to 0 if queries fail (table may not have reliable created_at)
    if (conversationsTodayResult.error) {
      conversationsToday = 0;
    }
    if (messagesTodayResult.error) {
      messagesToday = 0;
    }

    const recentCompanies = recentCompaniesResult.data ?? [];
    const recentActivity = recentActivityResult.data ?? [];
    const pluginAssignments = pluginAssignmentsResult.data ?? [];

    const pluginCountMap: Record<string, { name: string; icon: string | null; count: number }> = {};
    for (const row of pluginAssignments) {
      const p = (row as any).plugins;
      if (!p) continue;
      if (!pluginCountMap[row.plugin_id]) {
        pluginCountMap[row.plugin_id] = { name: p.name, icon: p.icon, count: 0 };
      }
      pluginCountMap[row.plugin_id].count++;
    }
    const topPlugins = Object.entries(pluginCountMap)
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    res.json({
      companiesActive,
      usersTotal,
      conversationsToday,
      messagesToday,
      recentCompanies: recentCompanies.map((c: any) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        active: c.active,
        createdAt: c.created_at,
      })),
      recentActivity: recentActivity.map((c: any) => ({
        id: c.id,
        company: (c.companies as any)?.name ?? "—",
        companyId: (c.companies as any)?.id ?? "",
        contact: (c.contacts as any)?.name ?? (c.contacts as any)?.wa_id ?? "—",
        createdAt: c.created_at,
      })),
      topPlugins,
    });
  } catch (error) {
    console.error("[super/dashboard error]", error);
    res.status(500).json({ error: "Error al obtener datos del dashboard" });
  }
});
