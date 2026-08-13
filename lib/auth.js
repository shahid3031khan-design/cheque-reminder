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

module.exports = { newPasswordHash, checkPassword, createSession, getSession, destroySession, requireAuth, requireAdmin };
