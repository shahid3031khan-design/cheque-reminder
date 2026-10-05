const crypto = require("crypto");

const PBKDF2_ITERATIONS = 100000;
const sessions = new Map(); // token -> { userId, username, role, displayName, expiresAt }

function newPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString("base64");
  const hash = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha256").toString("base64");
  return { hash, salt };
}

function checkPassword(password, hash, salt) {
  const computed = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, "sha256").toString("base64");
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
}

// The one main admin. Everyone else with the admin role is a sub admin.
const MAIN_ADMIN_USERNAME = String(process.env.MAIN_ADMIN_USERNAME || "shahid").toLowerCase();

function isMainAdmin(user) {
  return !!user && user.role === "admin" && String(user.username || "").toLowerCase() === MAIN_ADMIN_USERNAME;
}

// Reversible (encrypted) copy of a password so admins can look it up later. The PBKDF2 hash above is still
// what authenticates logins; this exists only for the "view password" feature. The key comes from the server's
// environment (PASSWORD_VIEW_KEY, falling back to the database URI), never from the database itself, so a
// copy of the database alone can't be decrypted.
function viewKey() {
  const secret = process.env.PASSWORD_VIEW_KEY || process.env.MONGODB_URI || "local-dev-only-key";
  return crypto.createHash("sha256").update("profile-password-view:" + secret).digest();
}

function encryptPassword(password) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", viewKey(), iv);
  const data = Buffer.concat([cipher.update(String(password), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString("base64")).join(".");
}

function decryptPassword(blob) {
  try {
    const [iv, tag, data] = String(blob).split(".").map((s) => Buffer.from(s, "base64"));
    const decipher = crypto.createDecipheriv("aes-256-gcm", viewKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return null; // wrong key (e.g. the database URI was rotated) or a damaged value
  }
}

function createSession(user, rememberMe) {
  const token = crypto.randomBytes(24).toString("hex");
  const ttlMs = rememberMe ? 30 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000;
  sessions.set(token, {
    userId: user.id,
    username: user.username,
    role: user.role,
    displayName: user.displayName,
    expiresAt: Date.now() + ttlMs,
  });
  return { token, ttlMs };
}

function getSession(token) {
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function destroySession(token) {
  sessions.delete(token);
}

function destroySessionsForUser(userId) {
  for (const [token, session] of sessions) {
    if (session.userId === userId) sessions.delete(token);
  }
}

function requireAuth(req, res, next) {
  const session = getSession(req.cookies?.session);
  if (!session) return res.status(401).json({ error: "Not authenticated" });
  req.user = session;
  next();
}

function requireAdmin(req, res, next) {
  const session = getSession(req.cookies?.session);
  if (!session) return res.status(401).json({ error: "Not authenticated" });
  if (session.role !== "admin") return res.status(403).json({ error: "Admin access required" });
  req.user = session;
  next();
}

module.exports = { newPasswordHash, checkPassword, isMainAdmin, encryptPassword, decryptPassword, createSession, getSession, destroySession, destroySessionsForUser, requireAuth, requireAdmin };
