const path = require("path");
const fs = require("fs");

function loadEnvFile() {
  const envPath = path.join(__dirname, "..", "..", ".env");
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function envNonEmpty(key) {
  const v = process.env[key];
  return Boolean(
    typeof v === "string" &&
      v.trim() &&
      !v.includes("YOUR_") &&
      !/^your[_-]/i.test(v.trim())
  );
}

loadEnvFile();

// 신규/Next.js 키 형식 별칭
if (!envNonEmpty("SUPABASE_URL") && envNonEmpty("NEXT_PUBLIC_SUPABASE_URL")) {
  process.env.SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL.trim();
}
if (!envNonEmpty("SUPABASE_ANON_KEY") && envNonEmpty("SUPABASE_PUBLISHABLE_KEY")) {
  process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_PUBLISHABLE_KEY.trim();
}
if (!envNonEmpty("SUPABASE_ANON_KEY") && envNonEmpty("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY")) {
  process.env.SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.trim();
}
if (!envNonEmpty("SUPABASE_ANON_KEY") && envNonEmpty("NEXT_PUBLIC_SUPABASE_ANON_KEY")) {
  process.env.SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.trim();
}
if (!envNonEmpty("SUPABASE_SERVICE_ROLE_KEY") && envNonEmpty("SUPABASE_SECRET_KEY")) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SECRET_KEY.trim();
}
if (!envNonEmpty("SUPABASE_SERVICE_ROLE_KEY") && envNonEmpty("SUPABASE_SERVICE_KEY")) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_KEY.trim();
}

function isSupabaseConfigured() {
  return envNonEmpty("SUPABASE_URL") && envNonEmpty("SUPABASE_SERVICE_ROLE_KEY");
}

module.exports = { loadEnvFile, isSupabaseConfigured, envNonEmpty };
