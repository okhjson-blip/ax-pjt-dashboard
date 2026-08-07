require("./env");
const path = require("path");
const fs = require("fs");
const express = require("express");
const cors = require("cors");
const { createRouter } = require("./routes");
const { isSupabaseConfigured } = require("./store");
const { createSeedData } = require("./seed-data");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "dashboard.json");
const PUBLIC_DIR = path.join(__dirname, "..", "..", "public");

function isVercelRuntime() {
  return Boolean(process.env.VERCEL);
}

function ensureLocalDataFileSync() {
  if (isSupabaseConfigured() || isVercelRuntime()) return;
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    const seed = createSeedData();
    seed.meta = seed.meta || {};
    seed.meta.lastSavedAt = new Date().toISOString();
    fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2), "utf8");
  }
}

/**
 * Express 앱 팩토리 (listen 없음).
 * - 로컬/Docker: server.js에서 listen
 * - Vercel: 루트 app.js가 default export
 */
function createApp() {
  if (isVercelRuntime() && !isSupabaseConfigured()) {
    throw new Error(
      "Vercel 배포에는 SUPABASE_URL과 SUPABASE_SECRET_KEY(또는 SUPABASE_SERVICE_ROLE_KEY)가 필요합니다."
    );
  }

  ensureLocalDataFileSync();

  const app = express();
  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json({ limit: "2mb" }));
  app.use("/api", createRouter());

  // 로컬/Docker용. Vercel에서는 public/** 을 CDN이 서빙하며 express.static은 무시됩니다.
  if (fs.existsSync(PUBLIC_DIR)) {
    app.use(express.static(PUBLIC_DIR));
  }

  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    const indexPath = path.join(PUBLIC_DIR, "index.html");
    if (!fs.existsSync(indexPath)) {
      return res.status(404).send("index.html not found");
    }
    res.sendFile(indexPath);
  });

  app.use((err, _req, res, _next) => {
    if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
      return res.status(400).json({ error: "요청 JSON 형식이 올바르지 않습니다." });
    }
    console.error(err);
    res.status(500).json({ error: err.message || "서버 오류가 발생했습니다." });
  });

  return app;
}

module.exports = {
  createApp,
  PUBLIC_DIR,
  isVercelRuntime,
  isSupabaseConfigured
};
