const fs = require("fs");
const path = require("path");
const { createSeedData } = require("./seed-data");
const { uid } = require("./store-utils");

const DATA_DIR = path.join(__dirname, "..", "data");
const DATA_FILE = path.join(DATA_DIR, "dashboard.json");

function assertWritableFs() {
  if (process.env.VERCEL) {
    throw new Error(
      "Vercel 환경에서는 로컬 JSON 저장을 사용할 수 없습니다. SUPABASE_URL / SUPABASE_SECRET_KEY를 설정하세요."
    );
  }
}

function ensureDataFile() {
  assertWritableFs();
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    writeDataSync(createSeedData());
  }
}

function writeDataSync(data) {
  assertWritableFs();
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  data.meta = data.meta || {};
  data.meta.lastSavedAt = new Date().toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf8");
  return data;
}

async function readData() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, "utf8");
  return JSON.parse(raw);
}

async function writeData(data) {
  return writeDataSync(data);
}

async function resetData() {
  const seed = createSeedData();
  return writeDataSync(seed);
}

module.exports = {
  DATA_FILE,
  readData,
  writeData,
  resetData,
  uid
};
