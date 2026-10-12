const POSITION_TITLES = [
  "부사장",
  "본부장",
  "상무보",
  "상무",
  "전무",
  "이사",
  "부장",
  "차장",
  "과장",
  "대리",
  "주임",
  "사원",
  "팀장",
  "실장",
  "수석",
  "책임",
  "선임"
];

function splitPmoList(value) {
  return String(value || "")
    .split(/[,，、;；|/]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function splitNamePosition(raw) {
  const text = String(raw || "").trim();
  if (!text) return { name: "", position: "" };
  for (const title of POSITION_TITLES) {
    const matched = text.match(new RegExp(`^(.+?)\\s+${title}$`));
    if (matched && matched[1].trim()) {
      return { name: matched[1].trim(), position: title };
    }
  }
  return { name: text, position: "" };
}

function emptyPmoMember() {
  return { name: "", position: "", email: "" };
}

function normalizePmoMember(row) {
  return {
    name: String(row?.name || "").trim(),
    position: String(row?.position || "").trim(),
    email: String(row?.email || "").trim()
  };
}

function normalizePmo(pmo) {
  const source = pmo && typeof pmo === "object" ? pmo : {};
  if (Array.isArray(source.members)) {
    return {
      members: source.members.map(normalizePmoMember).filter((row) => row.name || row.position || row.email)
    };
  }
  const names = splitPmoList(source.name);
  const emails = splitPmoList(source.email);
  const count = Math.max(names.length, emails.length);
  const members = [];
  for (let index = 0; index < count; index += 1) {
    const parsed = splitNamePosition(names[index] || "");
    members.push({
      name: parsed.name,
      position: parsed.position,
      email: emails[index] || ""
    });
  }
  return {
    members: members.filter((row) => row.name || row.position || row.email)
  };
}

function matchesCompanyPmo(company, name, email) {
  const nameKey = String(name || "").trim();
  const emailKey = String(email || "").trim().toLowerCase();
  if (!nameKey || !emailKey) return false;
  return normalizePmo(company?.pmo).members.some(
    (row) => row.name === nameKey && row.email.toLowerCase() === emailKey
  );
}

module.exports = {
  normalizePmo,
  matchesCompanyPmo,
  emptyPmoMember
};
