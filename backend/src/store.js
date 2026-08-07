require("./env");
const { isSupabaseConfigured } = require("./env");
const { uid } = require("./store-utils");

const driver = isSupabaseConfigured() ? require("./store-supabase") : require("./store-file");

if (isSupabaseConfigured()) {
  console.log("  DB driver: Supabase");
} else {
  console.log("  DB driver: local JSON (Supabase .env 미설정)");
}

module.exports = {
  DATA_FILE: driver.DATA_FILE,
  readData: (...args) => driver.readData(...args),
  writeData: (...args) => driver.writeData(...args),
  resetData: (...args) => driver.resetData(...args),
  uid,
  isSupabaseConfigured
};
