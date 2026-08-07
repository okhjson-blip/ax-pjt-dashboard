const { createApp, isSupabaseConfigured } = require("./app");

const PORT = Number(process.env.PORT) || 3080;
const HOST =
  process.env.HOST || (process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1");

function boot() {
  const app = createApp();

  app.listen(PORT, HOST, () => {
    console.log("");
    console.log("  AI 프로젝트 통합 대시보드");
    console.log(`  Frontend + Backend: http://${HOST}:${PORT}`);
    console.log(`  Health check:       http://${HOST}:${PORT}/api/health`);
    console.log(`  DB driver:          ${isSupabaseConfigured() ? "supabase" : "local JSON"}`);
    console.log("");
  });
}

try {
  boot();
} catch (err) {
  console.error(err);
  process.exit(1);
}
