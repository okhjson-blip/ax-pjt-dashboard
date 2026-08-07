require("./env");
const { resetData, isSupabaseConfigured } = require("./store");

async function main() {
  const data = await resetData();
  console.log(`시드 데이터를 초기화했습니다. driver=${isSupabaseConfigured() ? "supabase" : "json-file"}`);
  console.log(`협력사 ${data.companies.length}개`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
