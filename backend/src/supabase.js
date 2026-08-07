const { createClient } = require("@supabase/supabase-js");
const { isSupabaseConfigured } = require("./env");

let client = null;

function getSupabaseAdmin() {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase 환경변수가 설정되지 않았습니다. .env를 확인하세요.");
  }
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
  }
  return client;
}

module.exports = { getSupabaseAdmin };
