require("dotenv").config();
const path = require("path");
const express = require("express");
const cookieParser = require("cookie-parser");
const cron = require("node-cron");

const db = require("./lib/db");
const auth = require("./lib/auth");
const reminders = require("./lib/reminders");

const app = express();
const PORT = process.env.PORT || 8743;

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
  return { id: u.id, username: u.username, displayName: u.displayName, role: u.role, createdAt: u.createdAt };
}

// ---------- Auth ----------

app.post("/api/login", async (req, res) => {
  const username = String(req.body.username || "").trim();
  const user = await db.findUserByUsername(username);
  if (user && auth.checkPassword(req.body.password || "", user.passwordHash, user.passwordSalt)) {
    const { token, ttlMs } = auth.createSession(user, !!req.body.rememberMe);
    setSessionCookie(res, token, ttlMs);
    res.json(publicUser(user));
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
  res.json({ id: req.user.userId, username: req.user.username, role: req.user.role, displayName: req.user.displayName });
});

app.get("/api/display-settings", auth.requireAuth, async (req, res) => {
  const config = await db.getConfig();
  res.json({ currencySymbol: config.currencySymbol });
});

// ---------- Users (admin only) ----------

app.get("/api/users", auth.requireAdmin, async (req, res) => {
  const list = await db.getUsers();
  res.json(list.map(publicUser));
});

app.post("/api/users", auth.requireAdmin, async (req, res) => {
  const username = String(req.body.username || "").trim();
  const password = req.body.password || "";
  if (!username || !password) return res.status(400).json({ error: "Username and password are required" });
  if (await db.findUserByUsername(username)) return res.status(409).json({ error: "That username is already taken" });

  const role = req.body.role === "admin" ? "admin" : "employee";
  const pw = auth.newPasswordHash(password);
  const newUser = {
    id: db.newId("u"),
    username,
    displayName: req.body.displayName || username,
    role,
    passwordHash: pw.hash,
    passwordSalt: pw.salt,
    createdAt: new Date().toISOString(),
  };
  await db.insertUser(newUser);
  res.status(201).json(publicUser(newUser));
});

app.put("/api/users/:id/password", auth.requireAdmin, async (req, res) => {
  if (!req.body.password) return res.status(400).json({ error: "Password is required" });
  const target = await db.findUserById(req.params.id);
  if (!target) return res.status(404).json({ error: "User not found" });
  const pw = auth.newPasswordHash(req.body.password);
  await db.updateUserPassword(target.id, pw.hash, pw.salt);
  auth.destroySessionsForUser(target.id); // force re-login with the new password everywhere
  res.json({ ok: true });
});

app.delete("/api/users/:id", auth.requireAdmin, async (req, res) => {
  const target = await db.findUserById(req.params.id);
  if (!target) return res.status(404).json({ error: "User not found" });
  if (target.role === "admin" && (await db.countAdmins()) <= 1) {
    return res.status(400).json({ error: "Cannot delete the last admin account" });
  }
  await db.deleteUser(target.id);
  auth.destroySessionsForUser(target.id); // revoke any sessions the deleted account still held
  res.json({ ok: true });
});

// ---------- Cheques ----------

app.get("/api/cheques", auth.requireAuth, async (req, res) => {
  res.json(await db.getCheques());
});

app.post("/api/cheques", auth.requireAdmin, async (req, res) => {
  const b = req.body;
  const cheque = {
    id: db.newId("c"),
    dealId: db.newId("d"),
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

  const allCheques = await db.getCheques();
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
        id: db.newId("c"), ...sharedFields,
        chequeNumber: row.chequeNumber, amount: row.amount, depositDate: row.depositDate,
        status: "pending", createdAt: new Date().toISOString(),
      });
    }
  }

  await db.replaceDeal(key, resolvedDealId, keepCheques, newCheques);
  res.json([...keepCheques, ...newCheques].map((c) => ({ ...c, dealId: resolvedDealId })));
});

app.put("/api/cheques/:id", auth.requireAdmin, async (req, res) => {
  const updated = await db.updateCheque(req.params.id, req.body);
  if (!updated) return res.status(404).json({ error: "not found" });
  res.json(updated);
});

app.delete("/api/cheques/:id", auth.requireAdmin, async (req, res) => {
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

app.post("/api/test-reminder", auth.requireAdmin, async (req, res) => {
  const config = await db.getConfig();
  const title = "Cheque Reminder test";
  const message = "This is a test reminder from your Cheque Reminder app. If you can see/receive this, the channel works.";
  const results = {};
  if (config.email?.enabled) results.email = await reminders.sendEmail(config.email, title, message);
  if (config.whatsapp?.enabled) results.whatsapp = await reminders.sendWhatsApp(config.whatsapp, message);
  if (config.push?.enabled) results.push = await reminders.sendPush(config.push, title, message);
  res.json(results);
});

// ---------- Tracker (daily employee work log) ----------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function resolveTrackerUserId(req) {
  // Employees can only ever see their own tracker; admins may view anyone's via ?userId=
  if (req.query.userId && req.user.role === "admin") return req.query.userId;
  return req.user.userId;
}

app.get("/api/tracker/entries/:date", auth.requireAuth, async (req, res) => {
  if (!DATE_RE.test(req.params.date)) return res.status(400).json({ error: "Invalid date" });
  const userId = resolveTrackerUserId(req);
  const entry = await db.getTrackerEntry(userId, req.params.date);
  res.json(entry || { userId, date: req.params.date, plan: "", remarks: "", rating: null });
});

app.get("/api/tracker/month", auth.requireAuth, async (req, res) => {
  const year = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10);
  if (!year || !month || month < 1 || month > 12) return res.status(400).json({ error: "Invalid year/month" });
  const userId = resolveTrackerUserId(req);
  const entries = await db.getTrackerMonth(userId, year, month);
  res.json(entries);
});

app.put("/api/tracker/entries/:date", auth.requireAuth, async (req, res) => {
  if (!DATE_RE.test(req.params.date)) return res.status(400).json({ error: "Invalid date" });
  // Always the logged-in user's own entry - admins can view others' tracker but not edit them.
  const fields = {};
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
  const entry = await db.upsertTrackerEntry(req.user.userId, req.params.date, fields);
  res.json(entry);
});

// ---------- Tasks (admin assigns work to one or more employees) ----------

const PRIORITIES = ["low", "medium", "high"];
const TASK_STATUSES = ["pending", "in_progress", "done"];

app.get("/api/tasks", auth.requireAuth, async (req, res) => {
  if (req.user.role === "admin") {
    res.json(await db.getTasks());
  } else {
    res.json(await db.getTasksForUser(req.user.userId));
  }
});

app.post("/api/tasks", auth.requireAdmin, async (req, res) => {
  const b = req.body;
  const title = String(b.title || "").trim();
  if (!title) return res.status(400).json({ error: "Task title is required" });
  const assignedTo = Array.isArray(b.assignedTo) ? b.assignedTo.filter(Boolean) : [];
  if (assignedTo.length === 0) return res.status(400).json({ error: "Assign the task to at least one employee" });
  const priority = PRIORITIES.includes(b.priority) ? b.priority : "medium";
  const task = {
    id: db.newId("t"),
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
  res.status(201).json(task);
});

app.put("/api/tasks/:id", auth.requireAuth, async (req, res) => {
  const task = await db.findTaskById(req.params.id);
  if (!task) return res.status(404).json({ error: "Task not found" });

  if (req.user.role === "admin") {
    const fields = {};
    if (req.body.title !== undefined) fields.title = String(req.body.title).trim();
    if (req.body.description !== undefined) fields.description = String(req.body.description).slice(0, 5000);
    if (req.body.priority !== undefined && PRIORITIES.includes(req.body.priority)) fields.priority = req.body.priority;
    if (req.body.assignedTo !== undefined) {
      const assignedTo = Array.isArray(req.body.assignedTo) ? req.body.assignedTo.filter(Boolean) : [];
      if (assignedTo.length === 0) return res.status(400).json({ error: "Assign the task to at least one employee" });
      fields.assignedTo = assignedTo;
    }
    if (req.body.dueDate !== undefined) fields.dueDate = req.body.dueDate;
    if (req.body.status !== undefined) {
      if (!TASK_STATUSES.includes(req.body.status)) return res.status(400).json({ error: "Invalid status" });
      fields.status = req.body.status;
    }
    return res.json(await db.updateTask(task.id, fields));
  }

  // Employees may only update the status of a task assigned to them.
  if (!task.assignedTo.includes(req.user.userId)) return res.status(403).json({ error: "Not your task" });
  if (!TASK_STATUSES.includes(req.body.status)) return res.status(400).json({ error: "Invalid status" });
  res.json(await db.updateTask(task.id, { status: req.body.status }));
});

app.delete("/api/tasks/:id", auth.requireAdmin, async (req, res) => {
  await db.deleteTask(req.params.id);
  res.json({ ok: true });
});

// ---------- Calls (employee logs each call they make) ----------

function resolveCallsUserId(req) {
  // Employees can only ever see/add their own calls; admins may view anyone's via ?userId=
  if (req.query.userId && req.user.role === "admin") return req.query.userId;
  return req.user.userId;
}

app.get("/api/calls/day/:date", auth.requireAuth, async (req, res) => {
  if (!DATE_RE.test(req.params.date)) return res.status(400).json({ error: "Invalid date" });
  const userId = resolveCallsUserId(req);
  res.json(await db.getCallsForDay(userId, req.params.date));
});

app.get("/api/calls/month", auth.requireAuth, async (req, res) => {
  const year = parseInt(req.query.year, 10);
  const month = parseInt(req.query.month, 10);
  if (!year || !month || month < 1 || month > 12) return res.status(400).json({ error: "Invalid year/month" });
  const userId = resolveCallsUserId(req);
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

// ---------- Boot ----------

async function start() {
  await db.connectDB();
  console.log("Connected to MongoDB.");

  // Daily reminder sweep at 9am server time, plus dedupe means re-running is harmless.
  cron.schedule("0 9 * * *", () => {
    reminders.runDailyReminderCheck().catch((err) => console.error("Reminder check failed:", err));
  });

  app.listen(PORT, () => {
    console.log(`Cheque Reminder (cloud) listening on port ${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
