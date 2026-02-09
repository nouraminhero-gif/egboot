import axios from "axios";
import crypto from "crypto";

const FB_GRAPH = "https://graph.facebook.com/v19.0";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ENV: ${name}`);
  return v;
}

function randomState() {
  return crypto.randomBytes(16).toString("hex");
}

async function graphGET(path, params) {
  const res = await axios.get(`${FB_GRAPH}${path}`, { params });
  return res.data;
}

async function graphPOST(path, params, body = {}) {
  const res = await axios.post(`${FB_GRAPH}${path}`, body, { params });
  return res.data;
}

/**
 * Redis Keys (SaaS style)
 * - state:{state} -> userId (اختياري)
 * - user:{userId}:fb_user_token -> user access token (قصير/طويل)
 * - page:{pageId}:token -> PAGE_ACCESS_TOKEN (ده اللي هنستخدمه للردود)
 */
export function registerFacebookAuthRoutes(app, { redis }) {
  const FB_APP_ID = mustEnv("FB_APP_ID");
  const FB_APP_SECRET = mustEnv("FB_APP_SECRET");
  const BASE_URL = mustEnv("BASE_URL"); // مثال: https://egboot-production-dbb3.up.railway.app

  // ✅ 1) start connect
  // افتح: /connect?userId=123
  app.get("/connect", async (req, res) => {
    try {
      const userId = String(req.query.userId || "demo"); // مؤقتًا demo لحد ما تربطه بيوزر سيستم بتاعك
      const state = randomState();

      // خزّن الـ state عشان نتحقق في callback
      await redis.set(`state:${state}`, userId, "EX", 10 * 60); // 10 دقايق

      // permissions (حسب SaaS Messenger)
      const scope = [
        "public_profile",
        "email",
        "pages_show_list",
        "pages_manage_metadata",
        "pages_messaging",
        "pages_read_engagement",
      ].join(",");

      const redirectUri = `${BASE_URL}/auth/facebook/callback`;

      const fbUrl =
        `https://www.facebook.com/v19.0/dialog/oauth` +
        `?client_id=${encodeURIComponent(FB_APP_ID)}` +
        `&redirect_uri=${encodeURIComponent(redirectUri)}` +
        `&state=${encodeURIComponent(state)}` +
        `&response_type=code` +
        `&scope=${encodeURIComponent(scope)}`;

      return res.redirect(fbUrl);
    } catch (e) {
      return res.status(500).send(`Connect error: ${e?.message || e}`);
    }
  });

  // ✅ 2) callback
  app.get("/auth/facebook/callback", async (req, res) => {
    try {
      const code = req.query.code;
      const state = req.query.state;

      if (!code || !state) return res.status(400).send("Missing code/state");

      const userId = await redis.get(`state:${state}`);
      if (!userId) return res.status(400).send("State expired/invalid");

      const redirectUri = `${BASE_URL}/auth/facebook/callback`;

      // Exchange code -> short-lived user token
      const tokenData = await graphGET("/oauth/access_token", {
        client_id: FB_APP_ID,
        client_secret: FB_APP_SECRET,
        redirect_uri: redirectUri,
        code,
      });

      const userToken = tokenData.access_token;

      // (اختياري) exchange -> long-lived
      const longData = await graphGET("/oauth/access_token", {
        grant_type: "fb_exchange_token",
        client_id: FB_APP_ID,
        client_secret: FB_APP_SECRET,
        fb_exchange_token: userToken,
      });

      const longUserToken = longData.access_token || userToken;

      await redis.set(`user:${userId}:fb_user_token`, longUserToken, "EX", 60 * 60 * 24 * 50);

      // Get pages
      const pages = await graphGET("/me/accounts", {
        access_token: longUserToken,
      });

      const first = pages?.data?.[0];
      if (!first?.id || !first?.access_token) {
        return res
          .status(400)
          .send("No pages found. Make sure you are admin of a page.");
      }

      const pageId = first.id;
      const pageAccessToken = first.access_token;

      // خزّن توكن الصفحة (ده المهم للردود)
      await redis.set(`page:${pageId}:token`, pageAccessToken, "EX", 60 * 60 * 24 * 50);

      // subscribe app to page (عشان webhooks)
      try {
        await graphPOST(`/${pageId}/subscribed_apps`, { access_token: pageAccessToken });
      } catch (e) {
        // مش دايمًا بتفشل بسبب صلاحيات/مود
        console.log("⚠️ subscribe warning:", e?.response?.data || e?.message || e);
      }

      // صفحة بسيطة للمستخدم
      return res.send(
        `✅ Connected!\nuserId=${userId}\npageId=${pageId}\n\nNext: افتح /me عشان تتأكد التوكن متخزن (هنعملها بعدين)`
      );
    } catch (e) {
      return res.status(500).send(`Callback error: ${e?.response?.data?.error?.message || e?.message || e}`);
    }
  });

  // ✅ debug endpoint (اختياري مؤقت)
  app.get("/debug/page-token", async (req, res) => {
    const pageId = req.query.pageId;
    if (!pageId) return res.status(400).send("missing pageId");
    const tok = await redis.get(`page:${pageId}:token`);
    return res.send(tok ? "✅ token exists" : "❌ token missing");
  });

  console.log("✅ auth-facebook routes loaded: /connect , /auth/facebook/callback");
}
