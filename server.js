import express from "express";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;

// healthcheck
app.get("/health", (req, res) => {
  res.status(200).send("OK");
});

// webhook placeholder
app.post("/webhook", express.json(), (req, res) => {
  res.status(200).send("received");
});

const server = app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});

// Graceful shutdown (مهم جدا مع Railway)
process.on("SIGTERM", () => {
  console.log("🛑 SIGTERM received, shutting down server...");
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("🛑 SIGINT received");
  process.exit(0);
});
