import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { conversationsRouter } from "./routes/conversations.js";
import { tasksRouter } from "./routes/tasks.js";
import { aiRolesRouter } from "./routes/aiRoles.js";
import { teamRouter } from "./routes/team.js";
import { whatsappWebhookRouter } from "./routes/whatsappWebhook.js";
import { settingsRouter } from "./routes/settings.js";
import { metricsRouter } from "./routes/metrics.js";
import { auditRouter } from "./routes/audit.js";
import { superAdminRouter } from "./routes/superAdmin.js";
import { superCompaniesRouter } from "./routes/superCompanies.js";

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

app.use("/api/super/auth", authLimiter, superAdminRouter);
app.use("/api/super/companies", superCompaniesRouter);

// Global error handler — never leak stack traces
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[unhandled error]", err.message);
  if (res.headersSent) return;
  res.status(500).json({ error: "Error interno del servidor" });
});

const PORT = process.env.PORT ?? 3000;
app.listen(PORT, () => console.log(`Backend listening on http://localhost:${PORT}`));
