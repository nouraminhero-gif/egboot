// apps/webhook/auth-facebook.js
import axios from "axios";
import crypto from "crypto";
import IORedis from "ioredis";

const FB_GRAPH = "https://graph.facebook.com/v19.0";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ENV: ${name}`);
  return v;
}

function buildRedirectUri(baseUrl) {
  // مهم: لازم يطابق اللي هتحطه في Meta Developer (Valid OAuth Redirect URIs)
  return `${baseUrl.replace(/\/$/, "")}/facebook/callback`;
}

function safeHtml(text) {
  return String(text || "").replace(/[<>&"]/g, (c) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
  }[c]));
}

export function registerFacebookAuthRoutes(app) {
  const FB_APP_ID = mustEnv("FB_APP_ID");
  const FB_APP_SECRET = mustEnv("FB_APP_SECRET");
  const BASE_URL = mustEnv("BASE_URL"); // مثال: https://egboot-production-dbb3.up.railway.app

  const REDIS_URL = process.env.REDIS_URL || process.env.REDIS_PUBLIC_URL;
  if (!REDIS_URL) throw new Error("Missing REDIS_URL / REDIS_PUBLIC_URL");

  const redis = new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  const REDIRECT_URI = buildRedirectUri(BASE_URL);

  // ========= 1) Start OAuth: /connect =========
  // تقدر تبعت botId من تطبيقك: /connect?botId=clothes
  // وتقدر تحدد pageId لو عايز صفحة معينة: /connect?botId=clothes&pageId=123
  app.get("/connect", async (req, res) => {
    try {
      const botId = (req.query.botId || "default").toString();
      const desiredPageId = req.query.pageId ? String(req.query.pageId) : null;

      // state عشان الأمان + عشان نرجع botId بعد الكولباك
      const state = crypto.randomBytes(16).toString("hex");

      await redis.set(
        `fb_oauth_state:${state}`,
        JSON.stringify({ botId, desiredPageId }),
        "EX",
        10 * 60 // 10 دقائق
      );

      // الصلاحيات (ممكن تزود/تقلل حسب احتياجك)
      // لو هدفك Messenger على Pages غالبًا هتحتاج:
      // pages_show_list + pages_messaging + pages_manage_metadata
      const scope = [
        "pages_show_list",
        "pages_messaging",
        "pages_manage_metadata",
        "pages_read_engagement",
      ].join(",");

      const url =
        `https://www.facebook.com/v19.0/dialog/oauth` +
        `?client_id=${encodeURIComponent(FB_APP_ID)}` +
        `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
        `&state=${encodeURIComponent(state)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scope)}`;

      return res.redirect(url);
    } catch (e) {
      return res.status(500).send(`connect error: ${safeHtml(e?.message || e)}`);
    }
  });

  // ========= 2) OAuth Callback: /facebook/callback =========
  app.get("/facebook/callback", async (req, res) => {
    try {
      const code = req.query.code ? String(req.query.code) : null;
      const state = req.query.state ? String(req.query.state) : null;

      if (!code || !state) return res.status(400).send("Missing code/state");

      const stateRaw = await redis.get(`fb_oauth_state:${state}`);
      if (!stateRaw) return res.status(400).send("Invalid/expired state");

      await redis.del(`fb_oauth_state:${state}`);

      const { botId, desiredPageId } = JSON.parse(stateRaw);

      // 1) exchange code -> user access token
      const tokenResp = await axios.get(`${FB_GRAPH}/oauth/access_token`, {
        params: {
          client_id: FB_APP_ID,
          client_secret: FB_APP_SECRET,
          redirect_uri: REDIRECT_URI,
          hookup: "0",
          code,
        },
        timeout: 10000,
      });

      const userAccessToken = tokenResp.data?.access_token;
      if (!userAccessToken) return res.status(500).send("No user access token");

      // 2) get pages the user manages: /me/accounts
      const pagesResp = await axios.get(`${FB_GRAPH}/me/accounts`, {
        params: {
          access_token: userAccessToken,
          fields: "id,name,access_token",
        },
        timeout: 10000,
      });

      const pages = pagesResp.data?.data || [];
      if (!pages.length) {
        return res
          .status(400)
          .send("No pages found. Ensure the logged-in FB user manages at least one Page.");
      }

      // اختار صفحة واحدة: يا إما pageId اللي جاي من الكويري، يا إما أول صفحة
      const chosen =
        (desiredPageId && pages.find((p) => String(p.id) === String(desiredPageId))) ||
        pages[0];

      const pageId = String(chosen.id);
      const pageName = String(chosen.name || "");
      const pageAccessToken = chosen.access_token;

      if (!pageAccessToken) return res.status(500).send("No page access token");

      // 3) خزّن الإعدادات في Redis (SaaS style: لكل botId توكن مختلف)
      // تقدر تغيّر الكي حسب نظامك
      const key = `bot:${botId}:fb`;
      await redis.set(
        key,
        JSON.stringify({
          botId,
          pageId,
          pageName,
          pageAccessToken,
          connectedAt: Date.now(),
        })
      );

      // HTML بسيط يرجّعك للموبايل
      return res
        .status(200)
        .send(
          `
          <html>
            <body style="font-family:Arial;padding:20px">
              <h2>✅ Connected Successfully</h2>
              <p><b>botId:</b> ${safeHtml(botId)}</p>
              <p><b>Page:</b> ${safeHtml(pageName)} (${safeHtml(pageId)})</p>
              <p>دلوقتي البوت يقدر يشتغل بالـ Page Access Token اللي اتخزن في Redis.</p>
              <hr />
              <p>اختبار سريع:</p>
              <code>${safeHtml(BASE_URL)}/connect/status?botId=${safeHtml(botId)}</code>
            </body>
          </html>
          `
        );
    } catch (e) {
      const msg = e?.response?.data ? JSON.stringify(e.response.data) : (e?.message || e);
      return res.status(500).send(`callback error: ${safeHtml(msg)}`);
    }
  });

  // ========= 3) Status route: /connect/status =========
  app.get("/connect/status", async (req, res) => {
    try {
      const botId = (req.query.botId || "default").toString();
      const key = `bot:${botId}:fb`;
      const data = await redis.get(key);
      if (!data) return res.status(404).json({ ok: false, botId, connected: false });

      const parsed = JSON.parse(data);
      // متطلعش التوكن كامل في الاستاتس
      return res.json({
        ok: true,
        botId,
        connected: true,
        pageId: parsed.pageId,
        pageName: parsed.pageName,
        connectedAt: parsed.connectedAt,
      });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || String(e) });
    }
  });

  console.log("✅ Facebook OAuth routes loaded: /connect , /facebook/callback , /connect/status");
}
