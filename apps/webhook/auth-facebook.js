// apps/webhook/auth-facebook.js
// TEMP SAFE STUB - keeps the server running even if OAuth is not ready yet.

export function registerFacebookAuthRoutes(app) {
  // health route just to confirm module is loaded
  app.get("/auth/facebook", (req, res) => {
    res.status(200).send("Facebook auth is disabled temporarily ✅");
  });

  console.log("✅ auth-facebook.js loaded (SAFE STUB)");
}
