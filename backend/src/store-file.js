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
  let existing = {};
  if (fs.existsSync(DATA_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    } catch {
      existing = {};
    }
  }
  data.meta = data.meta || {};
  data.meta.lastSavedAt = new Date().toISOString();
  const replaceReports = Boolean(data.replaceCompanyWeeklyReports);
  delete data.replaceCompanyWeeklyReports;
  if (!replaceReports) {
    data.companyWeeklyReports = existing.companyWeeklyReports || [];
  } else if (!Array.isArray(data.companyWeeklyReports)) {
    data.companyWeeklyReports = existing.companyWeeklyReports || [];
  }
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
  seed.companyWeeklyReports = [];
  seed.replaceCompanyWeeklyReports = true;
  return writeDataSync(seed);
}

async function getCompanyWeeklyReport(companyId, weekNumber) {
  const data = await readData();
  return (data.companyWeeklyReports || []).find(
    (row) => row.companyId === companyId && Number(row.weekNumber) === Number(weekNumber)
  ) || null;
}

async function upsertCompanyWeeklyReport(doc) {
  const data = await readData();
  const reports = Array.isArray(data.companyWeeklyReports) ? data.companyWeeklyReports : [];
  const idx = reports.findIndex(
    (row) => row.companyId === doc.companyId && Number(row.weekNumber) === Number(doc.weekNumber)
  );
  const next = { ...doc, updatedAt: new Date().toISOString() };
  if (idx >= 0) reports[idx] = { ...reports[idx], ...next };
  else reports.push(next);
  data.companyWeeklyReports = reports;
  data.replaceCompanyWeeklyReports = true;
  writeDataSync(data);
  return next;
}

module.exports = {
  DATA_FILE,
  readData,
  writeData,
  resetData,
  getCompanyWeeklyReport,
  upsertCompanyWeeklyReport,
  uid
};
