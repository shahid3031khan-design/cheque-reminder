const { MongoClient } = require("mongodb");
const { newPasswordHash } = require("./auth");

let client;
let db;

async function connectDB() {
  if (db) return db;
  client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  db = client.db(process.env.MONGODB_DB || "cheque_reminder");
  await seedDefaults();
  return db;
}

function cheques() { return db.collection("cheques"); }
function users() { return db.collection("users"); }
function settingsCol() { return db.collection("settings"); }
function sentLogCol() { return db.collection("sent_log"); }
function trackerCol() { return db.collection("tracker_entries"); }

async function seedDefaults() {
  const userCount = await users().countDocuments();
  if (userCount === 0) {
    const adminPw = newPasswordHash("admin123");
    const empPw = newPasswordHash("employee123");
    await users().insertMany([
      { id: newId("u"), username: "admin", displayName: "Admin", role: "admin", passwordHash: adminPw.hash, passwordSalt: adminPw.salt, createdAt: new Date().toISOString() },
      { id: newId("u"), username: "employee", displayName: "Employee", role: "employee", passwordHash: empPw.hash, passwordSalt: empPw.salt, createdAt: new Date().toISOString() },
    ]);
  }
  const config = await settingsCol().findOne({ _key: "config" });
  if (!config) {
    await settingsCol().insertOne({
      _key: "config",
      currencySymbol: "AED ",
      reminderTime: "09:00",
      desktop: { enabled: false },
      email: { enabled: false, smtpHost: "smtp.gmail.com", smtpPort: 587, smtpUser: "", smtpAppPassword: "", to: "" },
      whatsapp: { enabled: false, phone: "", apiKey: "" },
      push: { enabled: false, ntfyTopic: "" },
    });
  }
}

function newId(prefix) {
  return `${prefix}_${Date.now()}_${Math.floor(Math.random() * 9999)}`;
}

// ---------- Cheques ----------

async function getCheques() {
  const docs = await cheques().find({}).toArray();
  return docs.map(stripMongoId);
}

async function saveCheque(cheque) {
  // insertOne mutates its argument in place (adds _id) - insert a copy so the
  // caller's object, and anything built from it in an API response, stays clean.
  await cheques().insertOne({ ...cheque });
  return cheque;
}

async function updateCheque(id, fields) {
  await cheques().updateOne({ id }, { $set: fields });
  return stripMongoId(await cheques().findOne({ id }));
}

async function deleteCheque(id) {
  await cheques().deleteOne({ id });
}

async function replaceDeal(dealKey, resolvedDealId, keepCheques, newCheques) {
  const keepIds = keepCheques.map((c) => c.id);
  const existingIds = (await cheques().find({ $or: [{ dealId: dealKey }, { dealId: { $exists: false }, id: dealKey }] }).toArray()).map((c) => c.id);
  const idsToDelete = existingIds.filter((id) => !keepIds.includes(id));
  if (idsToDelete.length) await cheques().deleteMany({ id: { $in: idsToDelete } });
  for (const c of keepCheques) {
    await cheques().updateOne({ id: c.id }, { $set: { ...c, dealId: resolvedDealId } });
  }
  if (newCheques.length) await cheques().insertMany(newCheques.map((c) => ({ ...c, dealId: resolvedDealId })));
}

// ---------- Users ----------

async function getUsers() {
  const docs = await users().find({}).toArray();
  return docs.map(stripMongoId);
}

async function findUserByUsername(username) {
  const doc = await users().findOne({ username: { $regex: `^${escapeRegex(username)}$`, $options: "i" } });
  return doc ? stripMongoId(doc) : null;
}

async function findUserById(id) {
  const doc = await users().findOne({ id });
  return doc ? stripMongoId(doc) : null;
}

async function insertUser(user) {
  await users().insertOne({ ...user });
  return user;
}

async function updateUserPassword(id, hash, salt) {
  await users().updateOne({ id }, { $set: { passwordHash: hash, passwordSalt: salt } });
}

async function deleteUser(id) {
  await users().deleteOne({ id });
}

async function countAdmins() {
  return users().countDocuments({ role: "admin" });
}

// ---------- Config ----------

async function getConfig() {
  const doc = await settingsCol().findOne({ _key: "config" });
  return stripMongoId(doc);
}

async function saveConfig(config) {
  await settingsCol().updateOne({ _key: "config" }, { $set: { ...config, _key: "config" } }, { upsert: true });
}

// ---------- Sent log (reminder dedupe) ----------

async function wasReminderSent(key) {
  return !!(await sentLogCol().findOne({ key }));
}

async function markReminderSent(key) {
  await sentLogCol().updateOne({ key }, { $set: { key, sentAt: new Date().toISOString() } }, { upsert: true });
}

// ---------- Tracker (daily employee work log) ----------

async function getTrackerEntry(userId, date) {
  const doc = await trackerCol().findOne({ userId, date });
  return doc ? stripMongoId(doc) : null;
}

async function upsertTrackerEntry(userId, date, fields) {
  const now = new Date().toISOString();
  await trackerCol().updateOne(
    { userId, date },
    { $set: { userId, date, ...fields, updatedAt: now }, $setOnInsert: { createdAt: now } },
    { upsert: true }
  );
  return getTrackerEntry(userId, date);
}

async function getTrackerMonth(userId, year, month) {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const docs = await trackerCol().find({ userId, date: { $regex: `^${escapeRegex(prefix)}` } }).toArray();
  return docs.map(stripMongoId);
}

function stripMongoId(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return rest;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  connectDB, newId,
  getCheques, saveCheque, updateCheque, deleteCheque, replaceDeal,
  getUsers, findUserByUsername, findUserById, insertUser, updateUserPassword, deleteUser, countAdmins,
  getConfig, saveConfig,
  wasReminderSent, markReminderSent,
  getTrackerEntry, upsertTrackerEntry, getTrackerMonth,
};
