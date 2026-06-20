import "dotenv/config";

if (!process.env.SUPABASE_JWT_SECRET || process.env.SUPABASE_JWT_SECRET.length < 32) {
  console.error('FATAL: SUPABASE_JWT_SECRET must be set and at least 32 chars');
  process.exit(1);
}
if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length < 64) {
  console.error('FATAL: ENCRYPTION_KEY must be a 64-char hex string');
  process.exit(1);
}
if (!process.env.WEBHOOK_VERIFY_TOKEN) {
  console.error('FATAL: WEBHOOK_VERIFY_TOKEN must be set');
  process.exit(1);
}
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { conversationsRouter } from "./routes/conversations.js";
import { tasksRouter } from "./routes/tasks.js";
import { aiRolesRouter } from "./routes/aiRoles.js";
import { teamRouter } from "./routes/team.js";
import { whatsappWebhookRouter } from "./routes/whatsappWebhook.js";
import webhookRouter from "./routes/webhook.js";
import { settingsRouter } from "./routes/settings.js";
import { metricsRouter } from "./routes/metrics.js";
import { auditRouter } from "./routes/audit.js";
import { authRouter } from "./routes/auth.js";
import { superAdminRouter } from "./routes/superAdmin.js";
import { superCompaniesRouter } from "./routes/superCompanies.js";
import { superUsersRouter } from "./routes/superUsers.js";
import { superDashboardRouter } from "./routes/superDashboard.js";
import { superPluginsRouter } from "./routes/superPlugins.js";
import { botsRouter } from "./routes/bots.js";

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL ?? "http://localhost:5173", credentials: true }));

// Preserve raw body on webhook route for HMAC signature verification
app.use(
  express.json({
    limit: "100kb",
    verify: (req, _res, buf) => {
      (req as Request & { rawBody?: Buffer }).rawBody = buf;
    },
  })
);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

app.use("/api/", apiLimiter);
app.use("/webhook/", webhookLimiter);

app.use("/api/conversations", conversationsRouter);
app.use("/api/tasks", tasksRouter);
app.use("/api/ai-roles", aiRolesRouter);
app.use("/api/team", teamRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/metrics", metricsRouter);
app.use("/api/audit", auditRouter);
app.use("/webhook/whatsapp", whatsappWebhookRouter);
app.use("/webhook", webhookRouter);

app.use("/api/bots", botsRouter);
app.use("/api/auth", authLimiter, authRouter);
app.use("/api/super/auth", authLimiter, superAdminRouter);
app.use("/api/super/companies", superCompaniesRouter);
app.use("/api/super/users", superUsersRouter);
app.use("/api/super/dashboard", superDashboardRouter);
app.use("/api/super/plugins", superPluginsRouter);

// Global error handler — never leak stack traces
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[unhandled error]", err.message);
  if (res.headersSent) return;
  res.status(500).json({ error: "Error interno del servidor" });
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));
