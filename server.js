require("dotenv").config();
// Render's servers run on UTC. Reminder times, "today" and the 9am sweep should follow the team's clock instead.
process.env.TZ = process.env.APP_TIMEZONE || "Asia/Dubai";
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const cron = require("node-cron");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");

const db = require("./lib/db");
const auth = require("./lib/auth");
const reminders = require("./lib/reminders");
const push = require("./lib/push");
const workspaces = require("./lib/workspaces");

const app = express();
const PORT = process.env.PORT || 8743;

// Render sits behind a reverse proxy - without this, express-rate-limit and
// the "secure" cookie flag would see every request as coming from the same
// internal proxy address/protocol instead of the real client.
app.set("trust proxy", 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // the small inline service-worker registration script
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"], // Google Fonts + one inline style attribute
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"], // clickjacking protection (belt-and-braces alongside X-Frame-Options)
    },
  },
}));

// Blanket API limiter as baseline abuse protection, plus a much stricter
// limiter on login specifically to slow down password brute-forcing.
app.use("/api/", rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please try again later." },
});

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public"), {
  setHeaders: (res) => res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate"),
}));

function setSessionCookie(res, token, ttlMs) {
  res.cookie("session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: ttlMs,
  });
}

function publicUser(u) {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    createdAt: u.createdAt,
    isMainAdmin: auth.isMainAdmin(u),
    hasViewablePassword: !!u.passwordEnc,
  };
}

// The company this request is working in (chosen at sign-in; see lib/workspaces.js).
function wsOf(req) {
  return workspaces.workspaceOf(req.user);
}

function sessionInfo(user, workspace) {
  return {
    ...publicUser(user),
    workspace,
    workspaceName: workspaces.nameOf(workspace),
    workspaces: workspaces.list(),
    canSwitchWorkspace: user.role === "admin",
  };
}

// ---------- Auth ----------

app.post("/api/login", loginLimiter, async (req, res) => {
  const username = String(req.body.username || "").trim();
  // Which company's button was tapped. Older screens (and the local app) send nothing: the person's own company.
  const requested = req.body.workspace === undefined || req.body.workspace === null ? null : String(req.body.workspace);
  if (requested !== null && !workspaces.isWorkspace(requested)) return res.status(400).json({ error: "Unknown company" });

  const user = await db.findUserByUsername(username);
  if (user && auth.checkPassword(req.body.password || "", user.passwordHash, user.passwordSalt)) {
    const workspace = requested || workspaces.workspaceOf(user);
    if (!workspaces.canEnter(user, workspace)) {
      const home = workspaces.nameOf(user);
      return res.status(403).json({ error: `This account doesn't have access to ${workspaces.nameOf(workspace)}. Use "Login to ${home}" instead.` });
    }
    // Accounts created before the view-password feature only have a hash. We hold the plaintext right now
    // (they just typed it correctly), so store the encrypted copy and it becomes viewable to admins.
    if (!user.passwordEnc) await db.setUserPasswordEnc(user.id, auth.encryptPassword(req.body.password));
    const { token, ttlMs } = auth.createSession(user, !!req.body.rememberMe, workspace);
    setSessionCookie(res, token, ttlMs);
    res.json(sessionInfo(user, workspace));
  } else {
    res.status(401).json({ error: "Invalid username or password" });
  }
});

app.post("/api/logout", (req, res) => {
  auth.destroySession(req.cookies?.session);
  res.clearCookie("session");
  res.json({ ok: true });
});

app.get("/api/me", auth.requireAuth, (req, res) => {
  const workspace = wsOf(req);
  res.json({
    id: req.user.userId, username: req.user.username, role: req.user.role, displayName: req.user.displayName,
    workspace, workspaceName: workspaces.nameOf(workspace), workspaces: workspaces.list(), canSwitchWorkspace: req.user.role === "admin",
  });
});

// Admins can enter either company; this moves the current sign-in to the other one without signing out.
app.post("/api/workspace", auth.requireAdmin, (req, res) => {
  const key = String(req.body.workspace || "");
  if (!workspaces.canEnter(req.user, key)) return res.status(400).json({ error: "Unknown company" });
  auth.setSessionWorkspace(req.cookies?.session, key);
  res.json({ workspace: key, workspaceName: workspaces.nameOf(key) });
});

app.get("/api/display-settings", auth.requireAuth, async (req, res) => {
  const config = await db.getConfig();
  res.json({ currencySymbol: config.currencySymbol });
});

// ---------- My Notifications (every user manages their own - admin included) ----------

app.get("/api/me/notifications", auth.requireAuth, async (req, res) => {
  const user = await db.findUserById(req.user.userId);
  res.json(user?.notify || db.DEFAULT_NOTIFY);
});

app.put("/api/me/notifications", auth.requireAuth, async (req, res) => {
  const b = req.body;
  const notify = {
    email: {
      enabled: !!b.email?.enabled,
      address: String(b.email?.address || "").trim(),
    },
    whatsapp: {
      enabled: !!b.whatsapp?.enabled,
      phone: String(b.whatsapp?.phone || "").trim(),
      apiKey: String(b.whatsapp?.apiKey || "").trim(),
    },
    push: {
      enabled: !!b.push?.enabled,
      ntfyTopic: String(b.push?.ntfyTopic || "").trim(),
    },
  };
  const updated = await db.updateUserNotifyPrefs(req.user.userId, notify);
  res.json(updated.notify);
});

app.post("/api/me/notifications/test", auth.requireAuth, async (req, res) => {
  const channel = req.body.channel;
  if (!["email", "whatsapp", "push"].includes(channel)) return res.status(400).json({ error: "Invalid channel" });

  const user = await db.findUserById(req.user.userId);
  const notify = user?.notify || {};
  const title = "Profile test";
  const message = "This is a test notification from your Profile app. If you can see/receive this, the channel works.";

  let ok = false;
  if (channel === "email") {
    const config = await db.getConfig();
    if (!config.email?.enabled) return res.status(400).json({ error: "Email sending isn't set up yet - ask your admin to configure it in Settings." });
    if (!notify.email?.address) return res.status(400).json({ error: "Enter your email address first" });
    ok = await reminders.sendEmail(config.email, notify.email.address, title, message);
  } else if (channel === "whatsapp") {
    if (!notify.whatsapp?.phone || !notify.whatsapp?.apiKey) return res.status(400).json({ error: "Enter your WhatsApp number and API key first" });
    ok = await reminders.sendWhatsApp(notify.whatsapp, message);
  } else if (channel === "push") {
    if (!notify.push?.ntfyTopic) return res.status(400).json({ error: "Enter your ntfy topic first" });
    ok = await reminders.sendPush(notify.push, title, message);
  }
  res.json({ ok });
});

// ---------- Phone notifications (Web Push) - every user manages their own devices ----------

app.get("/api/push/public-key", auth.requireAuth, async (req, res) => {
  try {
    res.json({ publicKey: await push.publicKey() });
  } catch (err) {
    console.error("Push keys unavailable:", err);
    res.status(503).json({ error: "Phone notifications aren't available right now" });
  }
});

app.post("/api/push/subscribe", auth.requireAuth, async (req, res) => {
  const sub = req.body.subscription;
  const endpoint = typeof sub?.endpoint === "string" ? sub.endpoint : "";
  const p256dh = typeof sub?.keys?.p256dh === "string" ? sub.keys.p256dh : "";
  const authKey = typeof sub?.keys?.auth === "string" ? sub.keys.auth : "";
  if (!endpoint || endpoint.length > 1000 || !p256dh || p256dh.length > 200 || !authKey || authKey.length > 100) {
    return res.status(400).json({ error: "Invalid subscription" });
  }
  if (!push.isAllowedEndpoint(endpoint)) return res.status(400).json({ error: "Unsupported notification service" });
  await db.addPushSubscription(req.user.userId, { endpoint, keys: { p256dh, auth: authKey } }, String(req.headers["user-agent"] || "").slice(0, 200));
  res.json({ ok: true });
});

app.post("/api/push/unsubscribe", auth.requireAuth, async (req, res) => {
  const endpoint = typeof req.body.endpoint === "string" ? req.body.endpoint : "";
  if (endpoint) await db.removePushSubscriptionForUser(req.user.userId, endpoint);
  res.json({ ok: true });
});

app.post("/api/push/test", auth.requireAuth, async (req, res) => {
  try {
    const sent = await push.sendToUser(req.user.userId, { title: "Profile test", body: "Notifications are working on this phone.", url: "/" });
    if (!sent) return res.status(400).json({ error: "No phone is registered for notifications yet" });
    res.json({ ok: true, sent });
  } catch (err) {
    console.error("Push test failed:", err);
    res.status(500).json({ error: "Couldn't send the test notification" });
  }
});

// ---------- Users (admin only) ----------

// The main admin (the developer's account) isn't shown to anyone but himself: not in any list, and by the
// neutral name "Admin" wherever his actions are shown to others.
function isHiddenFrom(target, viewerUserId) {
  return auth.isMainAdmin(target) && target.id !== viewerUserId;
}
function visibleName(target, viewerUserId) {
  return isHiddenFrom(target, viewerUserId) ? "Admin" : (target.displayName || target.username);
}

// The company's own employees plus every admin (admins can enter either company).
app.get("/api/users", auth.requireAdmin, async (req, res) => {
  const list = (await db.getUsers(wsOf(req))).filter((u) => !isHiddenFrom(u, req.user.userId));
  res.json(list.map(publicUser));
});

// Names for pickers (e.g. who to invite to a meeting). Open to everyone signed in, so only names and ids.
app.get("/api/people", auth.requireAuth, async (req, res) => {
  const list = (await db.getUsers(wsOf(req))).filter((u) => !isHiddenFrom(u, req.user.userId));
  res.json(list.map((u) => ({ id: u.id, name: u.displayName || u.username, role: u.role })));
});

// Admin screens may only act on people who are part of the company they're working in (and never on the
// main admin's account unless it's his own session).
async function findUserInWorkspace(req, id) {
  const target = await db.findUserById(id);
  if (!target || !workspaces.isMember(target, wsOf(req))) return null;
  return isHiddenFrom(target, req.user.userId) ? null : target;
}

// Only the main admin (Shahid) adds users; sub admins get a pointer to him.
// Caps: 1 main admin (Shahid himself - there can't be a second), 3 sub admins and 12 employees.
const MAX_SUB_ADMINS = 3;
const MAX_EMPLOYEES = 12;

app.post("/api/users", auth.requireAdmin, async (req, res) => {
  if (!auth.isMainAdmin(req.user)) return res.status(403).json({ error: "Ask Shahid to add new user" });
  const username = String(req.body.username || "").trim();
  const password = req.body.password || "";
  if (!username || !password) return res.status(400).json({ error: "Username and password are required" });
  if (await db.findUserByUsername(username)) return res.status(409).json({ error: "That username is already taken" });

  const role = req.body.role === "admin" ? "admin" : "employee";
  const workspace = wsOf(req);
  // Admins are counted across the whole app; employees per company (the list is this company's staff + all admins).
  const existing = await db.getUsers(workspace);
  if (role === "admin" && existing.filter((u) => u.role === "admin" && !auth.isMainAdmin(u)).length >= MAX_SUB_ADMINS) {
    return res.status(400).json({ error: `Maximum of ${MAX_SUB_ADMINS} sub admins reached` });
  }
  if (role === "employee" && existing.filter((u) => u.role === "employee").length >= MAX_EMPLOYEES) {
    return res.status(400).json({ error: `Maximum of ${MAX_EMPLOYEES} employees reached in ${workspaces.nameOf(workspace)}` });
  }
  const pw = auth.newPasswordHash(password);
  const newUser = {
    id: db.newId("u"),
    username,
    displayName: req.body.displayName || username,
    role,
    workspace, // an employee's company; for an admin it's just where they were created (they can enter either)
    passwordHash: pw.hash,
    passwordSalt: pw.salt,
    passwordEnc: auth.encryptPassword(password),
    createdAt: new Date().toISOString(),
  };
  await db.insertUser(newUser);
  res.status(201).json(publicUser(newUser));
});

// Who can see whose password: the main admin sees everyone's; a sub admin sees everyone's except the main
// admin's; an employee sees only their own. (Everyone can see their own.)
app.get("/api/users/:id/password", auth.requireAuth, async (req, res) => {
  const isSelf = req.params.id === req.user.userId;
  if (!isSelf && req.user.role !== "admin") return res.status(403).json({ error: "You can only see your own password" });
  const target = isSelf ? await db.findUserById(req.params.id) : await findUserInWorkspace(req, req.params.id);
  if (!target) return res.status(404).json({ error: "User not found" });
  if (!isSelf && auth.isMainAdmin(target) && !auth.isMainAdmin(req.user)) {
    return res.status(403).json({ error: "Only Shahid can see the main admin's password" });
  }
  res.set("Cache-Control", "no-store");
  const password = target.passwordEnc ? auth.decryptPassword(target.passwordEnc) : null;
  if (password === null) return res.json({ available: false });
  res.json({ available: true, password });
});

app.put("/api/users/:id/password", auth.requireAdmin, async (req, res) => {
  if (!req.body.password) return res.status(400).json({ error: "Password is required" });
  const target = await findUserInWorkspace(req, req.params.id);
  if (!target) return res.status(404).json({ error: "User not found" });
  if (auth.isMainAdmin(target) && !auth.isMainAdmin(req.user)) {
    return res.status(403).json({ error: "Only Shahid can change the main admin's password" });
  }
  const pw = auth.newPasswordHash(req.body.password);
  await db.updateUserPassword(target.id, pw.hash, pw.salt, auth.encryptPassword(req.body.password));
  auth.destroySessionsForUser(target.id); // force re-login with the new password everywhere
  res.json({ ok: true });
});

app.delete("/api/users/:id", auth.requireAdmin, async (req, res) => {
  const target = await findUserInWorkspace(req, req.params.id);
  if (!target) return res.status(404).json({ error: "User not found" });
  if (auth.isMainAdmin(target)) return res.status(403).json({ error: "The main admin account can't be deleted" });
  if (target.role === "admin" && (await db.countAdmins()) <= 1) {
    return res.status(400).json({ error: "Cannot delete the last admin account" });
  }
  await db.deleteUser(target.id);
  await db.removePushSubscriptionsForUser(target.id); // their phones stop getting notifications
  auth.destroySessionsForUser(target.id); // revoke any sessions the deleted account still held
  res.json({ ok: true });
});

// ---------- Cheques ----------

app.get("/api/cheques", auth.requireAuth, async (req, res) => {
  res.json(await db.getCheques(wsOf(req)));
});

// A cheque from the other company is "not found" here, exactly as if it didn't exist.
async function findChequeInWorkspace(req, id) {
  const cheque = await db.findChequeById(id);
  return cheque && workspaces.workspaceOf(cheque) === wsOf(req) ? cheque : null;
}

app.post("/api/cheques", auth.requireAdmin, async (req, res) => {
  const b = req.body;
  const cheque = {
    id: db.newId("c"),
    dealId: db.newId("d"),
    workspace: wsOf(req),
    ownerName: b.ownerName, tenantName: b.tenantName, propertyDetail: b.propertyDetail, ownerBankDetail: b.ownerBankDetail,
    chequeNumber: b.chequeNumber, amount: b.amount, depositDate: b.depositDate, notes: b.notes,
    status: "pending", createdAt: new Date().toISOString(),
  };
  await db.saveCheque(cheque);
  res.status(201).json(cheque);
});

app.post("/api/cheques/batch", auth.requireAdmin, async (req, res) => {
  const b = req.body;
  const rows = Array.isArray(b.cheques) ? b.cheques : [];
  if (rows.length === 0) return res.status(400).json({ error: "At least one cheque is required" });

  const dealId = db.newId("d");
  const created = rows.map((r) => ({
    id: db.newId("c"),
    dealId,
    workspace: wsOf(req),
    ownerName: b.ownerName, tenantName: b.tenantName, propertyDetail: b.propertyDetail, ownerBankDetail: b.ownerBankDetail,
    chequeNumber: r.chequeNumber, amount: r.amount, depositDate: r.depositDate, notes: b.notes,
    status: "pending", createdAt: new Date().toISOString(),
  }));
  for (const c of created) await db.saveCheque(c);
  res.status(201).json(created);
});

app.put("/api/deals/:key", auth.requireAdmin, async (req, res) => {
  const key = req.params.key;
  const b = req.body;
  const rows = Array.isArray(b.cheques) ? b.cheques : [];
  if (rows.length === 0) return res.status(400).json({ error: "A deal needs at least one cheque" });

  const allCheques = await db.getCheques(wsOf(req)); // this company's only
  const existingGroup = allCheques.filter((c) => (c.dealId && c.dealId === key) || (!c.dealId && c.id === key));
  if (existingGroup.length === 0) return res.status(404).json({ error: "Deal not found" });

  const resolvedDealId = existingGroup.find((c) => c.dealId)?.dealId || db.newId("d");
  const existingById = new Map(existingGroup.map((c) => [c.id, c]));

  const keepCheques = [];
  const newCheques = [];
  for (const row of rows) {
    const existing = row.id && existingById.get(row.id);
    const sharedFields = {
      ownerName: b.ownerName, tenantName: b.tenantName, propertyDetail: b.propertyDetail, ownerBankDetail: b.ownerBankDetail, notes: b.notes,
    };
    if (existing) {
      keepCheques.push({ ...existing, ...sharedFields, chequeNumber: row.chequeNumber, amount: row.amount, depositDate: row.depositDate });
    } else {
      newCheques.push({
        id: db.newId("c"), workspace: wsOf(req), ...sharedFields,
        chequeNumber: row.chequeNumber, amount: row.amount, depositDate: row.depositDate,
        status: "pending", createdAt: new Date().toISOString(),
      });
    }
  }

  await db.replaceDeal(key, resolvedDealId, keepCheques, newCheques);
  res.json([...keepCheques, ...newCheques].map((c) => ({ ...c, dealId: resolvedDealId })));
});

app.put("/api/cheques/:id", auth.requireAdmin, async (req, res) => {
  if (!(await findChequeInWorkspace(req, req.params.id))) return res.status(404).json({ error: "not found" });
  // A cheque can't be moved to the other company by an edit.
  const { workspace: _ignored, id: _id, ...fields } = req.body || {};
  const updated = await db.updateCheque(req.params.id, fields);
  if (!updated) return res.status(404).json({ error: "not found" });
  res.json(updated);
});

app.delete("/api/cheques/:id", auth.requireAdmin, async (req, res) => {
  if (!(await findChequeInWorkspace(req, req.params.id))) return res.status(404).json({ error: "not found" });
  await db.deleteCheque(req.params.id);
  res.json({ ok: true });
});

// ---------- Config / settings (admin only) ----------

app.get("/api/config", auth.requireAdmin, async (req, res) => {
  res.json(await db.getConfig());
});

app.put("/api/config", auth.requireAdmin, async (req, res) => {
  await db.saveConfig(req.body);
  res.json({ ok: true });
});

// ---------- Tracker (daily employee work log) ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const LEAVE_TYPES = ["sick", "annual", "casual", "other"];

// Whose tracker / pipeline / calls this request is about. Employees only ever see their own; admins may view
// someone else's via ?userId= - but only people of the company they're working in, and never the main admin's.
// Returns null when that person isn't visible (answered as "not found").
// The id is coerced to String so a crafted query string (e.g. ?userId[$ne]=null, which Express's query parser
// turns into an object) can never reach a MongoDB filter as an operator.
async function resolveViewedUserId(req) {
  if (!req.query.userId || req.user.role !== "admin") return req.user.userId;
  const id = String(req.query.userId);
  if (id === req.user.userId) return id;
  const target = await db.findUserById(id);
  if (!target || !workspaces.isMember(target, wsOf(req)) || isHiddenFrom(target, req.user.userId)) return null;
  return id;
}

app.get("/api/tracker/entries/:date", auth.requireAuth, async (req, res) => {
  if (!DATE_RE.test(req.params.date)) return res.status(400).json({ error: "Invalid date" });
  const userId = await resolveViewedUserId(req);
  if (!userId) return res.status(404).json({ error: "User not found" });
  const entry = await db.getTrackerEntry(userId, req.params.date);
  res.json(entry || { userId, date: req.params.date, loginTime: "", plan: "", remarks: "", rating: null, logoutTime: "", onLeave: false, leaveType: "", leaveReason: "" });
});

app.get("/api/tracker/month", auth.requireAuth, async (req, res) => {
  const year = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10);
  if (!year || !month || month < 1 || month > 12) return res.status(400).json({ error: "Invalid year/month" });
  const userId = await resolveViewedUserId(req);
  if (!userId) return res.status(404).json({ error: "User not found" });
  const entries = await db.getTrackerMonth(userId, year, month);
  res.json(entries);
});

app.put("/api/tracker/entries/:date", auth.requireAuth, async (req, res) => {
  if (!DATE_RE.test(req.params.date)) return res.status(400).json({ error: "Invalid date" });
  // Always the logged-in user's own entry - admins can view others' tracker but not edit them.
  const fields = {};
  for (const [key, label] of [["loginTime", "login"], ["logoutTime", "logout"]]) {
    if (req.body[key] === undefined) continue;
    const value = String(req.body[key]);
    if (!TIME_RE.test(value)) return res.status(400).json({ error: `Invalid ${label} time` });
    fields[key] = value;
  }
  if (req.body.leaveType !== undefined) {
    const leaveType = String(req.body.leaveType);
    if (leaveType !== "" && !LEAVE_TYPES.includes(leaveType)) return res.status(400).json({ error: "Invalid leave type" });
    fields.leaveType = leaveType;
  }
  if (req.body.leaveReason !== undefined) fields.leaveReason = String(req.body.leaveReason).slice(0, 500);
  if (req.body.onLeave !== undefined) {
    if (typeof req.body.onLeave !== "boolean") return res.status(400).json({ error: "Invalid leave status" });
    fields.onLeave = req.body.onLeave;
    if (!req.body.onLeave) { fields.leaveType = ""; fields.leaveReason = ""; } // cancelling a leave clears its details
  }
  if (req.body.plan !== undefined) fields.plan = String(req.body.plan).slice(0, 5000);
  if (req.body.remarks !== undefined) fields.remarks = String(req.body.remarks).slice(0, 5000);
  if (req.body.rating !== undefined) {
    if (req.body.rating === null) {
      fields.rating = null;
    } else {
      const rating = Number(req.body.rating);
      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        return res.status(400).json({ error: "Rating must be an integer from 1 to 5" });
      }
      fields.rating = rating;
    }
  }

  // Each step of the day unlocks the next: attendance -> morning plan -> evening plan -> logout.
  const existing = await db.getTrackerEntry(req.user.userId, req.params.date);
  const merged = { ...(existing || {}), ...fields };
  // A day is either worked (attendance flow) or a leave day - never both. Cancel the leave to work that day.
  if (fields.onLeave === true && existing?.loginTime) {
    return res.status(400).json({ error: "Attendance is already marked for this day" });
  }
  if (fields.onLeave === true && !merged.leaveType) {
    return res.status(400).json({ error: "Pick a leave type" });
  }
  if (merged.onLeave === true && (fields.loginTime !== undefined || fields.logoutTime !== undefined || fields.plan !== undefined || fields.remarks !== undefined || fields.rating !== undefined)) {
    return res.status(400).json({ error: "You're marked on leave for this day - cancel the leave first" });
  }
  if (fields.plan !== undefined && !merged.loginTime) {
    return res.status(400).json({ error: "Mark your attendance first" });
  }
  if ((fields.remarks !== undefined || fields.rating !== undefined) && !String(merged.plan || "").trim()) {
    return res.status(400).json({ error: "Save your morning plan first" });
  }
  if (fields.logoutTime !== undefined && !String(merged.remarks || "").trim()) {
    return res.status(400).json({ error: "Save your evening plan first" });
  }
  if ((fields.loginTime !== undefined || fields.logoutTime !== undefined) && merged.loginTime && merged.logoutTime && merged.logoutTime <= merged.loginTime) {
    return res.status(400).json({ error: "Logout time must be after login time" });
  }

  const entry = await db.upsertTrackerEntry(req.user.userId, req.params.date, fields);
  res.json(entry);
});

// ---------- Pipeline (monthly lead/closure progress per person) ----------

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_CLIENTS = 100;
const CLIENT_TYPES = ["family", "bachelor", "staff_sharing", "family_sharing"];
const CLIENT_FIELD_LIMITS = { name: 100, looking: 500, budget: 100, locations: 300, remark: 1000 };
const PIPELINE_METRICS = {
  leadsReceived: "Leads received",
  clientsInProcess: "Clients in process",
  expectedClosures: "Expected closures",
  dealsClosed: "Deals closed",
};

app.get("/api/tracker/pipeline/:month", auth.requireAuth, async (req, res) => {
  if (!MONTH_RE.test(req.params.month)) return res.status(400).json({ error: "Invalid month" });
  const userId = await resolveViewedUserId(req);
  if (!userId) return res.status(404).json({ error: "User not found" });
  const entry = await db.getPipeline(userId, req.params.month);
  if (entry) return res.json(entry);
  const empty = { userId, month: req.params.month };
  for (const key of Object.keys(PIPELINE_METRICS)) { empty[key] = null; empty[`${key}Remark`] = ""; }
  empty.clientDetails = [];
  res.json(empty);
});

app.put("/api/tracker/pipeline/:month", auth.requireAuth, async (req, res) => {
  if (!MONTH_RE.test(req.params.month)) return res.status(400).json({ error: "Invalid month" });
  // Always the logged-in user's own pipeline - admins can view others' but not edit them.
  const fields = {};
  for (const [key, label] of Object.entries(PIPELINE_METRICS)) {
    const raw = req.body[key];
    if (raw !== undefined) {
      if (raw === null || raw === "") {
        fields[key] = null;
      } else {
        const n = typeof raw === "number" || typeof raw === "string" ? Number(raw) : NaN;
        if (!Number.isInteger(n) || n < 0 || n > 1000000) {
          return res.status(400).json({ error: `${label} must be a whole number, 0 or more` });
        }
        fields[key] = n;
      }
    }
    if (req.body[`${key}Remark`] !== undefined) fields[`${key}Remark`] = String(req.body[`${key}Remark`]).slice(0, 1000);
  }
  // One details card per client in process (index = client number - 1); blank entries keep the positions aligned.
  if (req.body.clientDetails !== undefined) {
    const list = req.body.clientDetails;
    if (!Array.isArray(list)) return res.status(400).json({ error: "Client details must be a list" });
    const clients = [];
    for (const item of list.slice(0, MAX_CLIENTS)) {
      const c = item && typeof item === "object" ? item : {};
      const type = c.type === undefined || c.type === null ? "" : String(c.type);
      if (type !== "" && !CLIENT_TYPES.includes(type)) return res.status(400).json({ error: "Invalid client type" });
      const client = { type };
      for (const [field, max] of Object.entries(CLIENT_FIELD_LIMITS)) client[field] = String(c[field] ?? "").slice(0, max);
      clients.push(client);
    }
    fields.clientDetails = clients;
  }
  const entry = await db.upsertPipeline(req.user.userId, req.params.month, fields);
  res.json(entry);
});

// ---------- Achievement (Betterway's monthly figures per person, in place of SWK's pipeline) ----------

const ACHIEVEMENT_METRICS = {
  expected: "Expected",
  loggings: "Loggings",
  valuation: "Valuation",
  disbursement: "Disbursement",
};

app.get("/api/tracker/achievement/:month", auth.requireAuth, async (req, res) => {
  if (!MONTH_RE.test(req.params.month)) return res.status(400).json({ error: "Invalid month" });
  const userId = await resolveViewedUserId(req);
  if (!userId) return res.status(404).json({ error: "User not found" });
  const entry = await db.getAchievement(userId, req.params.month);
  if (entry) return res.json(entry);
  const empty = { userId, month: req.params.month };
  for (const key of Object.keys(ACHIEVEMENT_METRICS)) { empty[key] = null; empty[`${key}Remark`] = ""; }
  res.json(empty);
});

app.put("/api/tracker/achievement/:month", auth.requireAuth, async (req, res) => {
  if (!MONTH_RE.test(req.params.month)) return res.status(400).json({ error: "Invalid month" });
  // Always the logged-in user's own figures - admins can view others' but not edit them.
  const fields = {};
  for (const [key, label] of Object.entries(ACHIEVEMENT_METRICS)) {
    const raw = req.body[key];
    if (raw !== undefined) {
      if (raw === null || raw === "") {
        fields[key] = null;
      } else {
        const n = typeof raw === "number" || typeof raw === "string" ? Number(raw) : NaN;
        if (!Number.isFinite(n) || n < 0 || n > 1e12) return res.status(400).json({ error: `${label} must be a number, 0 or more` });
        fields[key] = n;
      }
    }
    if (req.body[`${key}Remark`] !== undefined) fields[`${key}Remark`] = String(req.body[`${key}Remark`]).slice(0, 1000);
  }
  const entry = await db.upsertAchievement(req.user.userId, req.params.month, fields);
  res.json(entry);
});

// ---------- Tasks (admin assigns work to one or more employees) ----------

const PRIORITIES = ["low", "medium", "high"];
const TASK_STATUSES = ["pending", "in_progress", "done"];

app.get("/api/tasks", auth.requireAuth, async (req, res) => {
  if (req.user.role === "admin") {
    res.json(await db.getTasks(wsOf(req)));
  } else {
    res.json(await db.getTasksForUser(req.user.userId));
  }
});

// A task can only be given to people of the company it's in (that company's employees, or any admin).
async function keepAssigneesInWorkspace(req, ids) {
  const allowed = new Set((await db.getUsers(wsOf(req))).map((u) => u.id));
  return ids.filter((id) => allowed.has(id));
}

async function findTaskInWorkspace(req, id) {
  const task = await db.findTaskById(id);
  return task && workspaces.workspaceOf(task) === wsOf(req) ? task : null;
}

app.post("/api/tasks", auth.requireAdmin, async (req, res) => {
  const b = req.body;
  const title = String(b.title || "").trim();
  if (!title) return res.status(400).json({ error: "Task title is required" });
  const requested = Array.isArray(b.assignedTo) ? b.assignedTo.filter((v) => typeof v === "string" && v).map(String) : [];
  const assignedTo = await keepAssigneesInWorkspace(req, requested);
  if (assignedTo.length === 0) return res.status(400).json({ error: "Assign the task to at least one employee" });
  const priority = PRIORITIES.includes(b.priority) ? b.priority : "medium";
  const task = {
    id: db.newId("t"),
    workspace: wsOf(req),
    title,
    description: String(b.description || "").slice(0, 5000),
    priority,
    assignedTo,
    assignedBy: req.user.userId,
    dueDate: b.dueDate || null,
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  await db.createTask(task);
  const allUsers = await db.getUsers();
  const assignedBy = allUsers.find((u) => u.id === req.user.userId) || { username: "Admin" };
  reminders.notifyTaskAssigned(task, assignedBy, allUsers).catch((err) => console.error("Task-assigned notify failed:", err));
  const unreachable = await reminders.unreachableAssignees(assignedTo, allUsers).catch(() => []);
  res.status(201).json({ ...task, unreachable });
});

app.put("/api/tasks/:id", auth.requireAuth, async (req, res) => {
  const task = req.user.role === "admin" ? await findTaskInWorkspace(req, req.params.id) : await db.findTaskById(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });

  if (req.user.role === "admin") {
    const fields = {};
    if (req.body.title !== undefined) fields.title = String(req.body.title).trim();
    if (req.body.description !== undefined) fields.description = String(req.body.description).slice(0, 5000);
    if (req.body.priority !== undefined && PRIORITIES.includes(req.body.priority)) fields.priority = req.body.priority;
    if (req.body.assignedTo !== undefined) {
      const requested = Array.isArray(req.body.assignedTo) ? req.body.assignedTo.filter((v) => typeof v === "string" && v).map(String) : [];
      const assignedTo = await keepAssigneesInWorkspace(req, requested);
      if (assignedTo.length === 0) return res.status(400).json({ error: "Assign the task to at least one employee" });
      fields.assignedTo = assignedTo;
    }
    if (req.body.dueDate !== undefined) fields.dueDate = req.body.dueDate;
    if (req.body.status !== undefined) {
      if (!TASK_STATUSES.includes(req.body.status)) return res.status(400).json({ error: "Invalid status" });
      fields.status = req.body.status;
    }
    const updated = await db.updateTask(task.id, fields);
    const allUsers = await db.getUsers();
    const actingUser = allUsers.find((u) => u.id === req.user.userId) || { username: "Admin", role: "admin" };
    if (fields.status === "done" && task.status !== "done") {
      reminders.notifyTaskDone(updated, actingUser, allUsers).catch((err) => console.error("Task-done notify failed:", err));
    }
    // Anyone newly added to the task is told, exactly as if it had been assigned to them from the start.
    const added = (fields.assignedTo || []).filter((id) => !task.assignedTo.includes(id));
    let unreachable = [];
    if (added.length && updated.status !== "done") {
      reminders.notifyTaskAssigned({ ...updated, assignedTo: added }, actingUser, allUsers).catch((err) => console.error("Task-assigned notify failed:", err));
      unreachable = await reminders.unreachableAssignees(added, allUsers).catch(() => []);
    }
    return res.json({ ...updated, unreachable });
  }

  // Employees may only update the status of a task assigned to them.
  if (!task.assignedTo.includes(req.user.userId)) return res.status(403).json({ error: "Not your task" });
  if (!TASK_STATUSES.includes(req.body.status)) return res.status(400).json({ error: "Invalid status" });
  const updated = await db.updateTask(task.id, { status: req.body.status });
  if (req.body.status === "done" && task.status !== "done") {
    const allUsers = await db.getUsers();
    const actingUser = allUsers.find((u) => u.id === req.user.userId) || { username: req.user.username, role: "employee" };
    reminders.notifyTaskDone(updated, actingUser, allUsers).catch((err) => console.error("Task-done notify failed:", err));
  }
  res.json(updated);
});

app.delete("/api/tasks/:id", auth.requireAdmin, async (req, res) => {
  if (!(await findTaskInWorkspace(req, req.params.id))) return res.status(404).json({ error: "Task not found" });
  await db.deleteTask(req.params.id);
  res.json({ ok: true });
});

// ---------- Calls (employee logs each call they make) ----------

app.get("/api/calls/day/:date", auth.requireAuth, async (req, res) => {
  if (!DATE_RE.test(req.params.date)) return res.status(400).json({ error: "Invalid date" });
  const userId = await resolveViewedUserId(req); // employees: their own; admins: anyone visible in this company
  if (!userId) return res.status(404).json({ error: "User not found" });
  res.json(await db.getCallsForDay(userId, req.params.date));
});

app.get("/api/calls/month", auth.requireAuth, async (req, res) => {
  const year = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10);
  if (!year || !month || month < 1 || month > 12) return res.status(400).json({ error: "Invalid year/month" });
  const userId = await resolveViewedUserId(req);
  if (!userId) return res.status(404).json({ error: "User not found" });
  const entries = await db.getCallsMonth(userId, year, month);
  const byDate = {};
  for (const c of entries) {
    if (!byDate[c.date]) byDate[c.date] = { date: c.date, count: 0, totalMinutes: 0 };
    byDate[c.date].count += 1;
    byDate[c.date].totalMinutes += Number(c.durationMinutes) || 0;
  }
  res.json(Object.values(byDate));
});

app.post("/api/calls", auth.requireAuth, async (req, res) => {
  const date = req.body.date;
  if (!DATE_RE.test(date)) return res.status(400).json({ error: "Invalid date" });
  const duration = Number(req.body.durationMinutes);
  if (!Number.isFinite(duration) || duration <= 0) {
    return res.status(400).json({ error: "Duration must be a positive number of minutes" });
  }
  // Always the logged-in user's own call log - admins can view others' calls but not add on their behalf.
  const call = {
    id: db.newId("call"),
    userId: req.user.userId,
    date,
    durationMinutes: duration,
    note: String(req.body.note || "").slice(0, 500),
    createdAt: new Date().toISOString(),
  };
  await db.createCall(call);
  res.status(201).json(call);
});

app.delete("/api/calls/:id", auth.requireAuth, async (req, res) => {
  const call = await db.findCallById(req.params.id);
  if (!call) return res.status(404).json({ error: "Call not found" });
  if (req.user.role !== "admin" && call.userId !== req.user.userId) {
    return res.status(403).json({ error: "Not your call entry" });
  }
  await db.deleteCall(req.params.id);
  res.json({ ok: true });
});

// ---------- Meetings (anyone can schedule one; people get alerts at 1 hour, 30 and 15 minutes before) ----------

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// What the screens need: who's coming, who made it, and whether this viewer may cancel it.
function presentMeeting(meeting, usersById, viewer) {
  const named = (id) => {
    const u = usersById.get(id);
    return u ? { id, name: visibleName(u, viewer.userId) } : { id, name: "Former user" };
  };
  return {
    id: meeting.id,
    title: meeting.title,
    date: meeting.date,
    time: meeting.time,
    location: meeting.location || "",
    createdBy: named(meeting.createdBy),
    attendees: (meeting.attendees || []).map(named),
    canCancel: meeting.createdBy === viewer.userId || viewer.role === "admin",
  };
}

// The meetings you scheduled or were invited to, in the company you're working in. Meetings that started more
// than an hour ago drop off the list.
app.get("/api/meetings", auth.requireAuth, async (req, res) => {
  const mine = (await db.getMeetings(wsOf(req), todayKey())).filter((m) => {
    const involved = m.createdBy === req.user.userId || (m.attendees || []).includes(req.user.userId);
    return involved && reminders.meetingStart(m).getTime() + 60 * 60 * 1000 >= Date.now();
  });
  const usersById = new Map((await db.getUsers()).map((u) => [u.id, u]));
  res.json(mine.map((m) => presentMeeting(m, usersById, req.user)));
});

app.post("/api/meetings", auth.requireAuth, async (req, res) => {
  const b = req.body || {};
  const title = String(b.title || "").trim().slice(0, 120);
  if (!title) return res.status(400).json({ error: "Give the meeting a title" });
  const date = String(b.date || "");
  const time = String(b.time || "");
  if (!DATE_RE.test(date) || !TIME_RE.test(time)) return res.status(400).json({ error: "Pick a date and a time" });
  const meeting = {
    id: db.newId("m"),
    workspace: wsOf(req),
    title,
    date,
    time,
    location: String(b.location || "").trim().slice(0, 200),
    createdBy: req.user.userId,
    attendees: [],
    createdAt: new Date().toISOString(),
  };
  if (reminders.meetingStart(meeting).getTime() <= Date.now()) return res.status(400).json({ error: "That time has already passed" });

  // Invitees must be people of this company the creator can see; the creator is always part of it.
  const people = (await db.getUsers(wsOf(req))).filter((u) => !isHiddenFrom(u, req.user.userId));
  const allowed = new Set(people.map((u) => u.id));
  const asked = Array.isArray(b.attendees) ? b.attendees.filter((v) => typeof v === "string") : [];
  meeting.attendees = [...new Set(asked)].filter((id) => allowed.has(id) && id !== req.user.userId).slice(0, 50);

  await db.createMeeting(meeting);
  const allUsers = await db.getUsers();
  const creator = allUsers.find((u) => u.id === req.user.userId) || { id: req.user.userId, username: req.user.username };
  reminders.notifyMeetingInvited(meeting, creator, allUsers).catch((err) => console.error("Meeting invite failed:", err));
  const usersById = new Map(allUsers.map((u) => [u.id, u]));
  res.status(201).json(presentMeeting(meeting, usersById, req.user));
});

app.delete("/api/meetings/:id", auth.requireAuth, async (req, res) => {
  const meeting = await db.findMeetingById(req.params.id);
  if (!meeting || workspaces.workspaceOf(meeting) !== wsOf(req)) return res.status(404).json({ error: "Meeting not found" });
  if (meeting.createdBy !== req.user.userId && req.user.role !== "admin") {
    return res.status(403).json({ error: "Only the person who scheduled it (or an admin) can cancel it" });
  }
  await db.deleteMeeting(meeting.id);
  const allUsers = await db.getUsers();
  const who = allUsers.find((u) => u.id === req.user.userId) || { id: req.user.userId, username: req.user.username };
  reminders.notifyMeetingCancelled(meeting, who, allUsers).catch((err) => console.error("Meeting cancel notice failed:", err));
  res.json({ ok: true });
});

// ---------- NOCs (SWK: PDF / image files of managements' No Objection Certificates) ----------

const NOC_MAX_BYTES = 10 * 1024 * 1024;
// The database's free plan is small, so total NOC storage stops at a cap (override with NOC_TOTAL_LIMIT_MB).
const NOC_TOTAL_LIMIT = (Number(process.env.NOC_TOTAL_LIMIT_MB) || 300) * 1024 * 1024;

// What a file really is, judged from its first bytes - never from its name or the type the browser claims.
function sniffNocFile(buf) {
  if (buf.length >= 5 && buf.toString("latin1", 0, 5) === "%PDF-") return { type: "application/pdf", ext: "pdf" };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: "image/png", ext: "png" };
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: "image/jpeg", ext: "jpg" };
  if (buf.length >= 12 && buf.toString("latin1", 0, 4) === "RIFF" && buf.toString("latin1", 8, 12) === "WEBP") return { type: "image/webp", ext: "webp" };
  return null;
}

function requireSwk(req, res, next) {
  if (wsOf(req) !== "swk") return res.status(403).json({ error: "NOCs belong to the SWK portal" });
  next();
}

function cleanText(value, max) {
  return String(value || "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
}

function presentNoc(noc, usersById, viewer) {
  const uploader = usersById.get(noc.uploadedBy);
  return {
    id: noc.id,
    management: noc.management,
    title: noc.title || "",
    filename: noc.filename,
    contentType: noc.contentType,
    size: noc.size,
    createdAt: noc.createdAt,
    uploadedBy: { id: noc.uploadedBy, name: uploader ? visibleName(uploader, viewer.userId) : "Former user" },
    canEdit: noc.uploadedBy === viewer.userId || viewer.role === "admin",
  };
}

async function findNoc(req, id) {
  const noc = await db.findNocById(id);
  return noc && workspaces.workspaceOf(noc) === "swk" ? noc : null;
}

app.get("/api/nocs", auth.requireAuth, requireSwk, async (req, res) => {
  const usersById = new Map((await db.getUsers()).map((u) => [u.id, u]));
  const list = await db.getNocs("swk");
  res.json(list.map((n) => presentNoc(n, usersById, req.user)));
});

// The file itself is the request body; its details travel in the query string.
app.post("/api/nocs", auth.requireAuth, requireSwk, express.raw({ type: () => true, limit: NOC_MAX_BYTES }), async (req, res) => {
  const body = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) return res.status(400).json({ error: "Choose a file to add" });
  const kind = sniffNocFile(body);
  if (!kind) return res.status(400).json({ error: "Only PDF, PNG, JPG or WebP files can be added" });
  const management = cleanText(req.query.management, 100);
  if (!management) return res.status(400).json({ error: "Enter the management's name" });
  if ((await db.nocStorageBytes()) + body.length > NOC_TOTAL_LIMIT) {
    return res.status(413).json({ error: "NOC storage is full. Delete files that are no longer needed first." });
  }
  let filename = cleanText(req.query.filename, 150).replace(/[\\/]/g, "_") || `NOC.${kind.ext}`;
  if (!/\.[A-Za-z0-9]{2,5}$/.test(filename)) filename += `.${kind.ext}`;
  const meta = {
    id: db.newId("n"),
    workspace: "swk",
    management,
    title: cleanText(req.query.title, 150),
    filename,
    contentType: kind.type,
    size: body.length,
    uploadedBy: req.user.userId,
    createdAt: new Date().toISOString(),
  };
  await db.createNoc(meta, body);
  const usersById = new Map((await db.getUsers()).map((u) => [u.id, u]));
  res.status(201).json(presentNoc(meta, usersById, req.user));
});

app.get("/api/nocs/:id/file", auth.requireAuth, requireSwk, async (req, res) => {
  const noc = await findNoc(req, req.params.id);
  const data = noc && (await db.getNocFile(noc.id));
  if (!noc || !data) return res.status(404).json({ error: "File not found" });
  const asciiName = noc.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  res.set({
    "Content-Type": noc.contentType,
    "Content-Length": String(data.length),
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=300",
    "Content-Disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(noc.filename)}`,
  });
  res.send(data);
});

// Fix a typo in the management name or the note. Only the person who added it, or an admin.
app.put("/api/nocs/:id", auth.requireAuth, requireSwk, async (req, res) => {
  const noc = await findNoc(req, req.params.id);
  if (!noc) return res.status(404).json({ error: "File not found" });
  if (noc.uploadedBy !== req.user.userId && req.user.role !== "admin") {
    return res.status(403).json({ error: "Only the person who added it (or an admin) can change it" });
  }
  const fields = {};
  if (req.body?.management !== undefined) {
    const management = cleanText(req.body.management, 100);
    if (!management) return res.status(400).json({ error: "Enter the management's name" });
    fields.management = management;
  }
  if (req.body?.title !== undefined) fields.title = cleanText(req.body.title, 150);
  const updated = await db.updateNoc(noc.id, fields);
  const usersById = new Map((await db.getUsers()).map((u) => [u.id, u]));
  res.json(presentNoc(updated, usersById, req.user));
});

app.delete("/api/nocs/:id", auth.requireAuth, requireSwk, async (req, res) => {
  const noc = await findNoc(req, req.params.id);
  if (!noc) return res.status(404).json({ error: "File not found" });
  if (noc.uploadedBy !== req.user.userId && req.user.role !== "admin") {
    return res.status(403).json({ error: "Only the person who added it (or an admin) can delete it" });
  }
  await db.deleteNoc(noc.id);
  res.json({ ok: true });
});

// Anything that goes wrong in a route comes back as JSON the app can show (a too-large upload most often).
app.use((err, req, res, next) => {
  if (err && err.type === "entity.too.large") {
    return res.status(413).json({ error: "That file is too big. The limit is 10 MB per file." });
  }
  console.error("Request failed:", err);
  if (res.headersSent) return next(err);
  res.status(err && err.status ? err.status : 500).json({ error: "Something went wrong" });
});

// ---------- Boot ----------

async function start() {
  await db.connectDB();
  console.log("Connected to MongoDB.");

  // Daily cheque/task sweep at 9am (team time - see the TZ line at the top), plus dedupe means re-running is harmless.
  cron.schedule("0 9 * * *", () => {
    reminders.runDailyReminderCheck().catch((err) => console.error("Reminder check failed:", err));
    reminders.runTaskReminderCheck().catch((err) => console.error("Task reminder check failed:", err));
  }, { timezone: process.env.TZ });

  // Attendance reminder: checked every 5 minutes so the admin can change the time in Settings. Each person is
  // reminded at most once a day, and the check also runs shortly after boot so a server that was asleep at the
  // reminder time still catches up when it wakes.
  const attendanceSweep = () => reminders.runAttendanceReminderCheck().catch((err) => console.error("Attendance reminder failed:", err));
  cron.schedule("*/5 * * * *", attendanceSweep, { timezone: process.env.TZ });
  setTimeout(attendanceSweep, 20 * 1000);

  // Meeting reminders (1 hour, 30 and 15 minutes before): checked every minute so they arrive on time.
  const meetingSweep = () => reminders.runMeetingReminderCheck().catch((err) => console.error("Meeting reminder failed:", err));
  cron.schedule("* * * * *", meetingSweep, { timezone: process.env.TZ });
  setTimeout(meetingSweep, 25 * 1000);

  app.listen(PORT, () => {
    console.log(`Cheque Reminder (cloud) listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
