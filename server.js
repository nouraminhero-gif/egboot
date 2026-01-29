import express from "express";
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import Redis from "ioredis";
import { Queue, Worker } from "bullmq";
import { z } from "zod";

import { requireAuth, hashPassword, verifyPassword, signToken } from "./auth.js";
import { fbSendText, fbTyping } from "./fb.js";
import { askAI } from "./ai.js";
import { buildSalesSystemPrompt, buildUserMessage } from "./sales.js";
import { extractOrderFields, buildOrderSheet } from "./order.js";

const app = express();
app.use(express.json());

const prisma = new PrismaClient();
const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const PORT = process.env.PORT || 8080;

const redis = new Redis(process.env.REDIS_URL);
const queue = new Queue("messages", { connection: redis });

// Dedup cache (in-memory سريع)
const processed = new Set();
setInterval(() => processed.clear(), 5 * 60 * 1000);

// ======================= AUTH (MVP) =======================
// Admin create tenant user / tenant login
app.post("/api/auth/register", async (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(6), tenantName: z.string().min(2) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });

  const { email, password, tenantName } = parsed.data;

  const tenant = await prisma.tenant.create({ data: { name: tenantName } });
  const user = await prisma.user.create({
    data: {
      email,
      password: await hashPassword(password),
      role: "tenant",
      tenantId: tenant.id
    }
  });

  const token = signToken({ userId: user.id, role: user.role, tenantId: tenant.id });
  res.json({ token, tenantId: tenant.id });
});

app.post("/api/auth/login", async (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });

  const user = await prisma.user.findUnique({ where: { email: parsed.data.email } });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const ok = await verifyPassword(parsed.data.password, user.password);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const token = signToken({ userId: user.id, role: user.role, tenantId: user.tenantId });
  res.json({ token, tenantId: user.tenantId });
});

// ======================= TENANT SETTINGS =======================
app.get("/api/me/tenant", requireAuth(), async (req, res) => {
  const tenantId = req.user.tenantId;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  res.json({ tenant });
});

app.put("/api/me/tenant", requireAuth(), async (req, res) => {
  const tenantId = req.user.tenantId;
  const schema = z.object({
    botName: z.string().min(2).optional(),
    tone: z.string().optional(),
    aggressiveness: z.number().min(1).max(10).optional(),
    returnPolicy: z.string().optional(),
    shippingPolicy: z.string().optional(),
    cashOnly: z.boolean().optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });

  const tenant = await prisma.tenant.update({
    where: { id: tenantId },
    data: parsed.data
  });
  res.json({ tenant });
});

// ======================= PRODUCTS =======================
app.get("/api/me/products", requireAuth(), async (req, res) => {
  const tenantId = req.user.tenantId;
  const products = await prisma.product.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  res.json({ products });
});

app.post("/api/me/products", requireAuth(), async (req, res) => {
  const tenantId = req.user.tenantId;
  const schema = z.object({
    name: z.string().min(2),
    price: z.number().int().min(1),
    material: z.string().optional(),
    colors: z.array(z.string()).min(1),
    sizes: z.array(z.string()).min(1),
    stockNote: z.string().optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });

  const product = await prisma.product.create({ data: { tenantId, ...parsed.data } });
  res.json({ product });
});

// ======================= PAGES (ربط الفيسبوك MVP) =======================
// MVP: العميل يحط pageId + pageAccessToken يدوي من التطبيق
app.get("/api/me/pages", requireAuth(), async (req, res) => {
  const tenantId = req.user.tenantId;
  const pages = await prisma.page.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
  res.json({ pages });
});

app.post("/api/me/pages", requireAuth(), async (req, res) => {
  const tenantId = req.user.tenantId;
  const schema = z.object({
    pageId: z.string().min(3),
    pageName: z.string().optional(),
    accessToken: z.string().min(10)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });

  const page = await prisma.page.upsert({
    where: { pageId: parsed.data.pageId },
    update: { tenantId, pageName: parsed.data.pageName, accessToken: parsed.data.accessToken },
    create: { tenantId, pageId: parsed.data.pageId, pageName: parsed.data.pageName, accessToken: parsed.data.accessToken }
  });

  res.json({ page });
});

// ======================= ORDERS =======================
app.get("/api/me/orders", requireAuth(), async (req, res) => {
  const tenantId = req.user.tenantId;
  const orders = await prisma.order.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, take: 50 });
  res.json({ orders });
});

// ======================= WEBHOOK VERIFY =======================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) return res.status(200).send(challenge);
  return res.sendStatus(403);
});

// ======================= WEBHOOK RECEIVE =======================
app.post("/webhook", (req, res) => {
  // الرد الفوري مهم جدًا
  res.status(200).send("EVENT_RECEIVED");

  const body = req.body;
  if (body.object !== "page") return;

  for (const entry of body.entry || []) {
    const fbPageId = String(entry.id || "");
    for (const event of entry.messaging || []) {
      const psid = event.sender?.id;
      if (!psid) continue;
      if (event.message?.is_echo) continue;

      const text = event.message?.text?.trim();
      if (!text) continue;

      const mid = event.message?.mid;
      const fallbackKey = `${fbPageId}|${psid}|${event.timestamp}|${text}`;
      const key = mid || fallbackKey;

      if (processed.has(key)) continue;
      processed.add(key);

      queue.add("process", {
        fbPageId,
        psid,
        mid: mid || null,
        text,
        timestamp: event.timestamp || null
      });
    }
  }
});

// ======================= HEALTH =======================
app.get("/", (req, res) => res.status(200).send("✅ Egboot Platform running"));

// ======================= WORKER (AI + DB + Send) =======================
const worker = new Worker(
  "messages",
  async (job) => {
    const { fbPageId, psid, mid, text, timestamp } = job.data;

    // 1) Page -> Tenant
    const page = await prisma.page.findUnique({ where: { pageId: fbPageId } });
    if (!page) return;

    const tenant = await prisma.tenant.findUnique({ where: { id: page.tenantId } });
    if (!tenant) return;

    // 2) Ensure conversation + session
    const convo = await prisma.conversation.upsert({
      where: { tenantId_pageId_psid: { tenantId: tenant.id, pageId: fbPageId, psid } },
      update: {},
      create: { tenantId: tenant.id, pageId: fbPageId, psid }
    });

    await prisma.message.create({
      data: {
        conversationId: convo.id,
        direction: "in",
        mid: mid || undefined,
        text,
        timestampMs: timestamp != null ? BigInt(timestamp) : undefined
      }
    });

    const session =
      (await prisma.session.findUnique({ where: { conversationId: convo.id } })) ||
      (await prisma.session.create({ data: { conversationId: convo.id } }));

    // 3) Quick extraction (regex)
    const extracted = extractOrderFields(text);

    // 4) Load catalog
    const products = await prisma.product.findMany({ where: { tenantId: tenant.id }, take: 50, orderBy: { createdAt: "desc" } });

    // 5) AI build prompt
    const systemPrompt = buildSalesSystemPrompt(tenant, products);
    const userMessage = buildUserMessage(text, { ...session, ...extracted });

    // typing on
    await fbTyping(page.accessToken, psid, true);

    const ai = await askAI({ systemPrompt, userMessage });

    // typing off
    await fbTyping(page.accessToken, psid, false);

    // 6) Update session
    const updates = { ...extracted, ...(ai.updates || {}) };
    await prisma.session.update({
      where: { conversationId: convo.id },
      data: cleanUpdates(updates)
    });

    // 7) Send reply
    const reply = ai.reply?.trim() || "ثواني براجع السيستم 🤍";
    await fbSendText(page.accessToken, psid, reply);

    await prisma.message.create({
      data: { conversationId: convo.id, direction: "out", text: reply }
    });

    // 8) إذا اكتملت البيانات الأساسية اعمل Order Draft
    const latestSession = await prisma.session.findUnique({ where: { conversationId: convo.id } });
    const hasMinimum =
      latestSession?.productName &&
      latestSession?.size &&
      latestSession?.color &&
      latestSession?.city &&
      latestSession?.phone;

    if (hasMinimum) {
      const product = products.find(p => p.name === latestSession.productName) || null;

      const sheetText = buildOrderSheet({ tenant, session: latestSession, product });
      // upsert draft order
      await prisma.order.create({
        data: {
          tenantId: tenant.id,
          conversationId: convo.id,
          status: "draft",
          sheetText
        }
      }).catch(() => {});
    }
  },
  { connection: redis, concurrency: 5 }
);

worker.on("failed", (job, err) => {
  console.error("Worker failed:", job?.id, err?.message);
});

function cleanUpdates(u) {
  const allowed = ["intent","productId","productName","size","color","city","address","phone","customerName"];
  const out = {};
  for (const k of allowed) if (u[k] != null && String(u[k]).trim() !== "") out[k] = u[k];
  return out;
}

app.listen(PORT, () => console.log("🚀 Server running on", PORT));
