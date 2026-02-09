// apps/webhook/auth-facebook.js
import crypto from "crypto";
import axios from "axios";

/**
 * لازم تبعتلي المسار الصح للـ redis connection عندك
 * هنا بافترض إنها موجودة في: apps/worker/queue.js
 * لو عندك مكان تاني غيّر سطر الاستيراد ده بس.
 */
import { connection } from "../worker/queue.js"; // <-- لو مختلف غيّره

const FB_OAUTH = "https://www.facebook.com/v19.0/dialog/oauth";
const FB_TOKEN = "https://graph.facebook.com/v19.0/oauth/access_token";
const FB_API = "https://graph.facebook.com/v19.0";

function signState(payload, secret) {
  const data = JSON.stringify(payload);
  const sig = crypto.createHmac("sha256", secret).update(data).digest("hex");
  return Buffer.from(JSON.stringify({ data, sig })).toString("base64url");
}

function verifyState(state, secret) {
  const raw = Buffer.from(state, "base64url").toString("utf8");
  const obj = JSON.parse(raw);
  const sig2 = crypto.createHmac("sha256", secret).update(obj.data).digest("hex");
  if (sig2 !== obj.sig) return null;
  return JSON.parse(obj.data);
}

export function registerFacebookAuthRoutes(app) {
  // 1) Start OAuth
  app.get("/auth/facebook/start", async (req, res) => {
    const uid = String(req.query.uid || "").trim();
    if (!uid) return res.status(400).send("Missing uid");

    const state = signState(
      { uid, t: Date.now() },
      process.env.STATE_SECRET || process.env.FB_APP_SECRET
    );

    const scope = [
      "public_profile",
      "email",
      "pages_show_list",
      "pages_read_engagement",
      "pages_manage_metadata",
      "pages_messaging",
    ].join(",");

    const url =
      `${FB_OAUTH}?client_id=${encodeURIComponent(process.env.FB_APP_ID)}` +
      `&redirect_uri=${encodeURIComponent(process.env.FB_REDIRECT_URI)}` +
      `&state=${encodeURIComponent(state)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(scope)}`;

    return res.redirect(url);
  });

  // 2) Callback
  app.get("/auth/facebook/callback", async (req, res) => {
    try {
      const code = req.query.code;
      const state = req.query.state;

      if (!code || !state) return res.status(400).send("Missing code/state");

      const parsed = verifyState(
        state,
        process.env.STATE_SECRET || process.env.FB_APP_SECRET
      );
      if (!parsed?.uid) return res.status(403).send("Bad state");

      const uid = parsed.uid;

      // exchange code -> user token
      const tokenResp = await axios.get(FB_TOKEN, {
        params: {
          client_id: process.env.FB_APP_ID,
          client_secret: process.env.FB_APP_SECRET,
          redirect_uri: process.env.FB_REDIRECT_URI,
          code,
        },
      });

      const userAccessToken = tokenResp.data.access_token;
      if (!userAccessToken) return res.status(500).send("No user token");

      // get pages list
      const pagesResp = await axios.get(`${FB_API}/me/accounts`, {
        params: { access_token: userAccessToken },
      });

      const pages = pagesResp.data?.data || [];
      if (!pages.length) {
        return res.status(200).send("No pages found for this account.");
      }

      // ✅ اختيار صفحة واحدة فقط: أول صفحة
      const picked = pages[0];
      const pageId = picked.id;
      const pageAccessToken = picked.access_token;

      if (!pageId || !pageAccessToken) {
        return res.status(500).send("Missing page token/id");
      }

      // ✅ خزّن في Redis
      await connection.set(`page:${pageId}:token`, pageAccessToken);
      await connection.set(`user:${uid}:page`, pageId);

      if (picked.name) await connection.set(`page:${pageId}:name`, picked.name);

      return res.status(200).send(`
        <html><body style="font-family:Arial;padding:20px">
          <h2>✅ Connected!</h2>
          <p><b>Page:</b> ${picked.name || ""}</p>
          <p><b>Page ID:</b> ${pageId}</p>
          <p>اقفل الصفحة وارجع للتطبيق.</p>
        </body></html>
      `);
    } catch (e) {
      console.error("FB callback error:", e?.response?.data || e?.message || e);
      return res.status(500).send("Callback failed");
    }
  });

  // 3) Status endpoint
  app.get("/auth/facebook/status", async (req, res) => {
    const uid = String(req.query.uid || "").trim();
    if (!uid) return res.status(400).json({ ok: false, error: "Missing uid" });

    const pageId = await connection.get(`user:${uid}:page`);
    if (!pageId) return res.json({ ok: true, connected: false });

    const name = await connection.get(`page:${pageId}:name`);
    return res.json({ ok: true, connected: true, pageId, pageName: name || "" });
  });
}
