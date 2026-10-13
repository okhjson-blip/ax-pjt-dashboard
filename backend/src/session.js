const crypto = require("crypto");

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function secret() {
  return process.env.SESSION_SECRET || process.env.ADMIN_PASSWORD || "admin2026";
}

function signSession(actor) {
  const payload = {
    role: actor.role,
    name: actor.name || "",
    email: actor.email || "",
    companyId: actor.companyId || null,
    participantId: actor.participantId || null,
    exp: Date.now() + SESSION_TTL_MS
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifySession(token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const actualBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(actualBuf, expectedBuf)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload?.exp || payload.exp < Date.now()) return null;
    if (!["admin", "pmo", "participant"].includes(payload.role)) return null;
    return payload;
  } catch {
    return null;
  }
}

function actorFromRequest(req) {
  const header = String(req.get("authorization") || "");
  const token = header.replace(/^Bearer\s+/i, "").trim();
  return verifySession(token);
}

module.exports = { signSession, verifySession, actorFromRequest };
