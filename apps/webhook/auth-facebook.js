console.log("🔥 auth-facebook.js LOADED");
// apps/webhook/auth-facebook.js
import crypto from "crypto";
import axios from "axios";

export function registerFacebookAuthRoutes(app) {
  const FB_OAUTH = "https://www.facebook.com/v19.0/dialog/oauth";
  const FB_TOKEN = "https://graph.facebook.com/v19.0/oauth/access_token";
  const FB_ME_ACCOUNTS = "https://graph.facebook.com/v19.0/me/accounts";

  const { FB_APP_ID, FB_APP_SECRET, FB_REDIRECT_URI } = process.env;

  if (!FB_APP_ID || !FB_APP_SECRET || !FB_REDIRECT_URI) {
    console.warn(
      "⚠️ Missing FB env vars: FB_APP_ID/FB_APP_SECRET/FB_REDIRECT_URI"
    );
  }

  // ================= Connect =================
  // /connect?email=someone@gmail.com
  app.get("/connect", async (req, res) => {
    try {
      const email = String(req.query.email || "").trim().toLowerCase();
      if (!email) return res.status(400).send("Missing email");

      // state عشوائي ضد الاختراق
      const state = crypto.randomBytes(16).toString("hex");

      // خزّن state -> email لمدة 10 دقايق
      await app.locals.redis.set(`oauth_state:${state}`, email, "EX", 600);

      const params = new URLSearchParams({
        client_id: FB_APP_ID,
        redirect_uri: FB_REDIRECT_URI,
        state,
        response_type: "code",
        scope: [
          "pages_messaging",
          "pages_manage_metadata",
          "pages_read_engagement",
          "pages_manage_engagement",
          "pages_show_list",
        ].join(","),
      });

      return res.redirect(`${FB_OAUTH}?${params.toString()}`);
    } catch (e) {
      console.error("❌ /connect error:", e?.message || e);
      return res.status(500).send("Connect error");
    }
  });

  // ================= Callback =================
  // /auth/facebook/callback
  app.get("/auth/facebook/callback", async (req, res) => {
    try {
      const code = String(req.query.code || "");
      const state = String(req.query.state || "");

      if (!code || !state) return res.status(400).send("Missing code/state");

      const email = await app.locals.redis.get(`oauth_state:${state}`);
      if (!email) return res.status(400).send("State expired or invalid");

      // هات user access token
      const tokenResp = await axios.get(FB_TOKEN, {
        params: {
          client_id: FB_APP_ID,
          client_secret: FB_APP_SECRET,
          redirect_uri: FB_REDIRECT_URI,
          code,
        },
        timeout: 15000,
      });

      const userAccessToken = tokenResp.data.access_token;
      if (!userAccessToken) return res.status(400).send("No user access token");

      // هات الصفحات اللي عنده + page access token
      const pagesResp = await axios.get(FB_ME_ACCOUNTS, {
        params: { access_token: userAccessToken },
        timeout: 15000,
      });

      const pages = pagesResp.data?.data || [];
      if (!pages.length) return res.status(400).send("No pages found");

      const page = pages[0];
      const pageId = page.id;
      const pageAccessToken = page.access_token;

      // خزّن ربط الصفحة بالمستخدم
      await app.locals.redis.set(`user:${email}:page_id`, pageId);
      await app.locals.redis.set(`user:${email}:page_token`, pageAccessToken);
      await app.locals.redis.set(`page:${pageId}:owner_email`, email);

      await app.locals.redis.del(`oauth_state:${state}`);

      return res.send(`✅ Connected OK for ${email}<br/>PageID: ${pageId}`);
    } catch (e) {
      console.error("❌ callback error:", e?.response?.data || e?.message || e);
      return res.status(500).send("Callback error");
    }
  });
}
