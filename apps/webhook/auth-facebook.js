import crypto from "crypto";
import axios from "axios";

export function registerFacebookAuthRoutes(app) {

  const FB_OAUTH = "https://www.facebook.com/v19.0/dialog/oauth";
  const FB_TOKEN = "https://graph.facebook.com/v19.0/oauth/access_token";
  const FB_ME = "https://graph.facebook.com/v19.0/me/accounts";

  app.get("/connect", async (req, res) => {
    const email = String(req.query.email || "").trim().toLowerCase();
    if (!email) return res.status(400).send("Missing email");

    const state = crypto.randomBytes(16).toString("hex");

    await app.locals.redis.set(`oauth:${state}`, email, "EX", 600);

    const params = new URLSearchParams({
      client_id: process.env.FB_APP_ID,
      redirect_uri: process.env.FB_REDIRECT_URI,
      state,
      scope: "pages_show_list,pages_messaging,pages_manage_metadata",
    });

    res.redirect(`${FB_OAUTH}?${params}`);
  });

  app.get("/auth/facebook/callback", async (req, res) => {
    const { code, state } = req.query;

    const email = await app.locals.redis.get(`oauth:${state}`);
    if (!email) return res.send("Invalid state");

    const tokenRes = await axios.get(FB_TOKEN, {
      params: {
        client_id: process.env.FB_APP_ID,
        client_secret: process.env.FB_APP_SECRET,
        redirect_uri: process.env.FB_REDIRECT_URI,
        code,
      },
    });

    const userToken = tokenRes.data.access_token;

    const pages = await axios.get(FB_ME, {
      params: { access_token: userToken },
    });

    const page = pages.data.data[0];

    await app.locals.redis.set(`user:${email}:page_token`, page.access_token);

    res.send("✅ Connected!");
  });

}
