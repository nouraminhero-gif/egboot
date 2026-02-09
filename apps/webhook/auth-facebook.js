// apps/webhook/auth-facebook.js
import axios from "axios";
import crypto from "crypto";

const FB_GRAPH = "https://graph.facebook.com/v19.0";

// هنستخدم Redis اللي عندك بنفس URL
import IORedis from "ioredis";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ENV: ${name}`);
  return v;
}

export function registerFacebookAuthRoutes(app) {
  const FB_APP_ID = mustEnv("FB_APP_ID");
  const FB_APP_SECRET = mustEnv("FB_APP_SECRET");
  const BASE_URL = mustEnv("BASE_URL");
  const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL;

  if (!REDIS_URL) throw new Error("Missing REDIS_URL");

  const redis = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  // ✅ 0) صفحة بسيطة توضّح لينك الدخول
  app.get("/connect", (req, res) => {
    // clientId ده معناه "العميل في SaaS" (يوزر عندك)
    // مؤقتًا هنخليه Query Param لحد ما تربطه بحساباتك
    const clientId = req.query.clientId || "demo_client";
    res.type("html").send(`
      <html>
        <head><meta charset="utf-8"/></head>
        <body style="font-family:Arial;padding:20px">
          <h2>Connect Facebook Page</h2>
          <p>Client: <b>${clientId}</b></p>
          <a style="padding:10px 14px;background:#1877F2;color:#fff;border-radius:8px;text-decoration:none"
             href="/auth/facebook/start?clientId=${encodeURIComponent(clientId)}">
             Login with Facebook
          </a>
        </body>
      </html>
    `);
  });

  // ✅ 1) Start OAuth
  app.get("/auth/facebook/start", async (req, res) => {
    const clientId = req.query.clientId;
    if (!clientId) return res.status(400).send("Missing clientId");

    // state علشان الأمان + نعرف مين العميل
    const state = crypto.randomBytes(16).toString("hex");

    // نخزن state → clientId لمدة 10 دقائق
    await redis.set(`oauth_state:${state}`, String(clientId), "EX", 600);

    const redirectUri = `${BASE_URL}/auth/facebook/callback`;

    // Permissions للبوت
    const scope = [
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_metadata",
      "pages_messaging",
    ].join(",");

    const url =
      `https://www.facebook.com/v19.0/dialog/oauth` +
      `?client_id=${encodeURIComponent(FB_APP_ID)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(state)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scope)}`;

    return res.redirect(url);
  });

  // ✅ 2) Callback: exchange code -> user access token -> fetch pages
  app.get("/auth/facebook/callback", async (req, res) => {
    try {
      const code = req.query.code;
      const state = req.query.state;
      if (!code || !state) return res.status(400).send("Missing code/state");

      const clientId = await redis.get(`oauth_state:${state}`);
      if (!clientId) return res.status(400).send("State expired/invalid");

      await redis.del(`oauth_state:${state}`);

      const redirectUri = `${BASE_URL}/auth/facebook/callback`;

      // Exchange code for user access token
      const tokenResp = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
        params: {
          client_id: FB_APP_ID,
          client_secret: FB_APP_SECRET,
          redirect_uri: redirectUri,
          code,
        },
      });

      const userAccessToken = tokenResp.data?.access_token;
      if (!userAccessToken) return res.status(500).send("No user access token");

      // Get pages list
      const pagesResp = await axios.get(`${FB_GRAPH}/me/accounts`, {
        params: {
          access_token: userAccessToken,
          fields: "id,name,access_token",
        },
      });

      const pages = pagesResp.data?.data || [];

      if (!pages.length) {
        return res.type("html").send(`
          <html><body style="font-family:Arial;padding:20px">
            <h3>No Pages found</h3>
            <p>الحساب ده مفيهوش Pages أو مش عنده صلاحيات Admin.</p>
          </body></html>
        `);
      }

      // خزّن الصفحات مؤقتًا للعميل لمدة 10 دقائق علشان يختار واحدة
      await redis.set(
        `client_pages_tmp:${clientId}`,
        JSON.stringify(pages),
        "EX",
        600
      );

      // اعرض اختيار صفحة واحدة
      const listHtml = pages
        .map(
          (p) => `
          <li style="margin:10px 0">
            <b>${escapeHtml(p.name)}</b> <small>(${p.id})</small><br/>
            <a style="display:inline-block;margin-top:6px;padding:8px 12px;background:#16a34a;color:#fff;border-radius:8px;text-decoration:none"
               href="/auth/facebook/connect?clientId=${encodeURIComponent(clientId)}&pageId=${encodeURIComponent(p.id)}">
               Connect this Page
            </a>
          </li>`
        )
        .join("");

      return res.type("html").send(`
        <html>
          <head><meta charset="utf-8"/></head>
          <body style="font-family:Arial;padding:20px">
            <h2>Select ONE Page to connect</h2>
            <p>Client: <b>${escapeHtml(clientId)}</b></p>
            <ul style="padding-left:18px">${listHtml}</ul>
          </body>
        </html>
      `);
    } catch (e) {
      console.error("❌ OAuth callback error:", e?.response?.data || e?.message || e);
      return res.status(500).send("OAuth callback failed");
    }
  });

  // ✅ 3) Connect: pick one page -> store page token in Redis -> subscribe app
  app.get("/auth/facebook/connect", async (req, res) => {
    try {
      const clientId = req.query.clientId;
      const pageId = req.query.pageId;
      if (!clientId || !pageId) return res.status(400).send("Missing clientId/pageId");

      const tmp = await redis.get(`client_pages_tmp:${clientId}`);
      if (!tmp) return res.status(400).send("Pages list expired. Start again /connect");

      const pages = JSON.parse(tmp);
      const page = pages.find((p) => String(p.id) === String(pageId));
      if (!page?.access_token) return res.status(400).send("Page not found or missing token");

      const pageAccessToken = page.access_token;

      // ✅ خزّن التوكن في Redis (ده اللي worker هيقراه)
      await redis.set(`page_token:${pageId}`, pageAccessToken);

      // ✅ ربط العميل بالصفحة (مفيد للوحة التحكم بتاعتك)
      await redis.set(`client_page:${clientId}`, String(pageId));
      await redis.set(`page_client:${pageId}`, String(clientId));

      // ✅ اشترك الـ Page في webhook events
      await axios.post(
        `${FB_GRAPH}/${pageId}/subscribed_apps`,
        {},
        { params: { access_token: pageAccessToken } }
      );

      // نظّف المؤقت
      await redis.del(`client_pages_tmp:${clientId}`);

      return res.type("html").send(`
        <html><body style="font-family:Arial;padding:20px">
          <h2>✅ Connected!</h2>
          <p>Client: <b>${escapeHtml(clientId)}</b></p>
          <p>Page: <b>${escapeHtml(page.name)}</b> (${pageId})</p>
          <p>تم حفظ التوكن + تم Subscribe للـ Webhook.</p>
          <hr/>
          <p>اختبر: ابعت رسالة للصفحة والبوت هيرد.</p>
        </body></html>
      `);
    } catch (e) {
      console.error("❌ Connect error:", e?.response?.data || e?.message || e);
      return res.status(500).send("Connect failed");
    }
  });

  // ✅ endpoint بسيط تشوف منه العميل موصل ايه (مفيد للدعم)
  app.get("/debug/client", async (req, res) => {
    const clientId = req.query.clientId || "demo_client";
    const pageId = await redis.get(`client_page:${clientId}`);
    const hasToken = pageId ? !!(await redis.get(`page_token:${pageId}`)) : false;
    res.json({ clientId, pageId, hasToken });
  });
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
