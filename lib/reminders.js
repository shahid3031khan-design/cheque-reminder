const nodemailer = require("nodemailer");
const db = require("./db");
const push = require("./push");
const workspaces = require("./workspaces");
const auth = require("./auth");

// "[SWK] " / "[Betterway] " - admins can be in both companies, so alerts say which one they're about.
function tag(record) {
  return `[${workspaces.nameOf(record)}] `;
}

// The main admin (the developer) isn't named to anyone else; his actions show up as "Admin".
function shownName(user) {
  if (auth.isMainAdmin(user)) return "Admin";
  return user?.displayName || user?.username || "Someone";
}

const MILESTONES = [7, 3, 2, 1, 0]; // cheques: 1 week before, then daily for the last 3 days (+ due day)
const TASK_DUE_MILESTONES = [1, 0]; // tasks: due tomorrow, then due today

function daysUntil(dateStr, today = new Date()) {
  const d = new Date(dateStr + "T00:00:00");
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d - t) / 86400000);
}

function formatChequeMessage(cheque, daysLeft, currencySymbol) {
  const when =
    daysLeft === 7 ? `in 1 week (on ${cheque.depositDate})` :
    daysLeft === 0 ? `TODAY (${cheque.depositDate})` :
    `in ${daysLeft} day(s) (on ${cheque.depositDate})`;
  const numPart = cheque.chequeNumber ? ` (Cheque #${cheque.chequeNumber})` : "";
  const propPart = cheque.propertyDetail ? ` for ${cheque.propertyDetail}` : "";
  return `${tag(cheque)}Cheque Reminder: ${cheque.tenantName} -> ${cheque.ownerName}${propPart} - ${currencySymbol}${cheque.amount}${numPart} is due for deposit ${when}.`;
}

async function sendEmail(smtpConfig, toAddress, subject, body) {
  try {
    const transport = nodemailer.createTransport({
      host: smtpConfig.smtpHost,
      port: smtpConfig.smtpPort,
      secure: false,
      auth: { user: smtpConfig.smtpUser, pass: smtpConfig.smtpAppPassword },
    });
    await transport.sendMail({ from: smtpConfig.smtpUser, to: toAddress, subject, text: body });
    return true;
  } catch (err) {
    console.warn("Email send failed:", err.message);
    return false;
  }
}

async function sendWhatsApp(waConfig, message) {
  try {
    const url = `https://api.callmebot.com/whatsapp.php?phone=${encodeURIComponent(waConfig.phone)}&text=${encodeURIComponent(message)}&apikey=${encodeURIComponent(waConfig.apiKey)}`;
    await fetch(url);
    return true;
  } catch (err) {
    console.warn("WhatsApp send failed:", err.message);
    return false;
  }
}

async function sendPush(pushConfig, title, message) {
  try {
    await fetch(`https://ntfy.sh/${encodeURIComponent(pushConfig.ntfyTopic)}`, {
      method: "POST",
      body: message,
      headers: { Title: title, Priority: "high", Tags: "money_with_wings" },
    });
    return true;
  } catch (err) {
    console.warn("Push send failed:", err.message);
    return false;
  }
}

// Dispatches to whichever channels this user has enabled on their own notify prefs.
// smtpConfig is the shared sending account (admin-configured) - email only goes out
// if that's enabled too, since there's no sender to send it through otherwise.
// Phones that have notifications turned on (see push.js) always get it too; `url` is where tapping it opens.
async function notifyUser(user, smtpConfig, title, message, url = "/") {
  try {
    await push.sendToUser(user.id, { title, body: message, url });
  } catch (err) {
    console.warn("Phone push failed:", err.message);
  }
  const notify = user.notify || {};
  if (smtpConfig?.enabled && notify.email?.enabled && notify.email?.address) {
    await sendEmail(smtpConfig, notify.email.address, title, message);
  }
  if (notify.whatsapp?.enabled && notify.whatsapp?.phone && notify.whatsapp?.apiKey) {
    await sendWhatsApp(notify.whatsapp, message);
  }
  if (notify.push?.enabled && notify.push?.ntfyTopic) {
    await sendPush(notify.push, title, message);
  }
}

// ---------- Cheque due-date reminders (admins only) ----------

async function runDailyReminderCheck() {
  const config = await db.getConfig();
  const allCheques = await db.getCheques();
  const admins = (await db.getUsers()).filter((u) => u.role === "admin");
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);

  for (const cheque of allCheques) {
    if (cheque.status === "deposited" || cheque.status === "bounced") continue;
    const daysLeft = daysUntil(cheque.depositDate, today);
    if (!MILESTONES.includes(daysLeft)) continue;

    const message = formatChequeMessage(cheque, daysLeft, config.currencySymbol || "");
    const title = daysLeft === 0 ? "Cheque due TODAY" : daysLeft <= 3 ? `Cheque due in ${daysLeft} day(s)` : "Cheque due in 1 week";

    for (const admin of admins) {
      const logKey = `cheque|${cheque.id}|${daysLeft}|${todayKey}|${admin.id}`;
      if (await db.wasReminderSent(logKey)) continue;
      await notifyUser(admin, config.email, title, message);
      await db.markReminderSent(logKey);
    }
    console.log(`[${todayKey}] ${message}`);
  }
}

// ---------- Task reminders (assignee for due-soon, admin for overdue/completed) ----------

async function runTaskReminderCheck() {
  const config = await db.getConfig();
  const allTasks = await db.getTasks();
  const allUsers = await db.getUsers();
  const usersById = new Map(allUsers.map((u) => [u.id, u]));
  const admins = allUsers.filter((u) => u.role === "admin");
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);

  for (const task of allTasks) {
    if (task.status === "done" || !task.dueDate) continue;
    const daysLeft = daysUntil(task.dueDate, today);

    if (TASK_DUE_MILESTONES.includes(daysLeft)) {
      const when = daysLeft === 0 ? "TODAY" : "tomorrow";
      const message = `${tag(task)}Task Reminder: "${task.title}" is due ${when} (${task.dueDate}).`;
      const title = daysLeft === 0 ? "Task due today" : "Task due tomorrow";
      for (const userId of task.assignedTo || []) {
        const user = usersById.get(userId);
        if (!user) continue;
        const logKey = `task-due|${task.id}|${daysLeft}|${todayKey}|${userId}`;
        if (await db.wasReminderSent(logKey)) continue;
        await notifyUser(user, config.email, title, message, "/?go=tasks");
        await db.markReminderSent(logKey);
      }
    }

    if (daysLeft < 0) {
      const statusLabel = task.status === "in_progress" ? "in progress" : "not started";
      const message = `${tag(task)}Task Overdue: "${task.title}" was due on ${task.dueDate} and is still ${statusLabel}.`;
      for (const admin of admins) {
        const logKey = `task-overdue|${task.id}|${todayKey}|${admin.id}`;
        if (await db.wasReminderSent(logKey)) continue;
        await notifyUser(admin, config.email, "Task overdue", message, "/?go=tasks");
        await db.markReminderSent(logKey);
      }
    }
  }
}

// ---------- Immediate task notifications (fired from the API routes, not the cron) ----------

async function notifyTaskAssigned(task, assignedBy, allUsers) {
  const config = await db.getConfig();
  const usersById = new Map(allUsers.map((u) => [u.id, u]));
  const message = `${tag(task)}${shownName(assignedBy)} assigned you a new task: "${task.title}"${task.dueDate ? ` (due ${task.dueDate})` : ""}.`;
  for (const userId of task.assignedTo || []) {
    const user = usersById.get(userId);
    if (!user) continue;
    await notifyUser(user, config.email, "New task assigned", message, "/?go=tasks");
  }
}

// Names of the given people who have no way to be alerted right now (no phone with notifications turned on,
// and no email / WhatsApp / ntfy set up). The assigner is shown this so they know to ask those people to turn
// notifications on - the task itself still appears in their Tasks tab either way.
async function unreachableAssignees(userIds, allUsers) {
  const config = await db.getConfig();
  const usersById = new Map(allUsers.map((u) => [u.id, u]));
  const names = [];
  for (const userId of userIds || []) {
    const user = usersById.get(userId);
    if (!user) continue;
    const notify = user.notify || {};
    const hasOtherChannel =
      (config.email?.enabled && notify.email?.enabled && notify.email?.address) ||
      (notify.whatsapp?.enabled && notify.whatsapp?.phone && notify.whatsapp?.apiKey) ||
      (notify.push?.enabled && notify.push?.ntfyTopic);
    if (hasOtherChannel) continue;
    if ((await db.getPushSubscriptions(user.id)).length > 0) continue;
    names.push(user.displayName || user.username);
  }
  return names;
}

async function notifyTaskDone(task, actingUser, allUsers) {
  const config = await db.getConfig();
  const message = `${tag(task)}Task "${task.title}" was marked done by ${shownName(actingUser)}.`;
  const admins = allUsers.filter((u) => u.role === "admin" && u.id !== actingUser.id);
  for (const admin of admins) {
    await notifyUser(admin, config.email, "Task completed", message, "/?go=tasks");
  }
}

// ---------- Meetings: an invitation when scheduled, then reminders 1 hour, 30 and 15 minutes before ----------

const MEETING_REMINDER_MINUTES = [60, 30, 15];

// Meeting date + time are the team's wall-clock time; the server clock is set to the same zone (see server.js).
function meetingStart(meeting) {
  return new Date(`${meeting.date}T${meeting.time}:00`);
}

function meetingWhen(meeting) {
  return `${meeting.date} at ${meeting.time}${meeting.location ? `, ${meeting.location}` : ""}`;
}

function meetingPeople(meeting) {
  return [...new Set([meeting.createdBy, ...(meeting.attendees || [])])];
}

async function notifyMeetingInvited(meeting, creator, allUsers) {
  const config = await db.getConfig();
  const usersById = new Map(allUsers.map((u) => [u.id, u]));
  const message = `${tag(meeting)}${shownName(creator)} scheduled a meeting: "${meeting.title}" on ${meetingWhen(meeting)}.`;
  for (const userId of meeting.attendees || []) {
    const user = usersById.get(userId);
    if (user && userId !== meeting.createdBy) await notifyUser(user, config.email, "Meeting invitation", message, "/?go=meetings");
  }
}

async function notifyMeetingCancelled(meeting, cancelledBy, allUsers) {
  const config = await db.getConfig();
  const usersById = new Map(allUsers.map((u) => [u.id, u]));
  const message = `${tag(meeting)}${shownName(cancelledBy)} cancelled the meeting "${meeting.title}" (${meetingWhen(meeting)}).`;
  for (const userId of meetingPeople(meeting)) {
    const user = usersById.get(userId);
    if (user && userId !== cancelledBy.id) await notifyUser(user, config.email, "Meeting cancelled", message, "/?go=meetings");
  }
}

// Run every minute. Each person is told once at each of 60 / 30 / 15 minutes before. If the meeting was scheduled
// (or the server woke up) after one of those points has passed, only the closest applicable reminder is sent -
// never a burst of stale ones - and meetings that already started are left alone.
async function runMeetingReminderCheck(now = new Date()) {
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const meetings = await db.getMeetingsBetween(localDateKey(now), localDateKey(tomorrow));
  if (meetings.length === 0) return 0;

  const config = await db.getConfig();
  const usersById = new Map((await db.getUsers()).map((u) => [u.id, u]));
  const levels = [...MEETING_REMINDER_MINUTES].sort((a, b) => a - b); // 15, 30, 60
  let sent = 0;

  for (const meeting of meetings) {
    const minutesLeft = (meetingStart(meeting).getTime() - now.getTime()) / 60000;
    if (minutesLeft <= 0) continue;
    const level = levels.find((l) => minutesLeft <= l); // the closest point already reached
    if (level === undefined) continue; // more than an hour away
    // Say "in 1 hour / 30 / 15 minutes" when the reminder fires on time (within a minute and a half of the mark);
    // if it's genuinely late (server was asleep, meeting scheduled at short notice) give the real minutes left.
    const shown = level - minutesLeft < 1.5 ? level : Math.max(1, Math.round(minutesLeft));
    const when = shown >= 60 ? "in 1 hour" : `in ${shown} minutes`;
    const message = `${tag(meeting)}Meeting "${meeting.title}" starts ${when} (${meeting.time}${meeting.location ? `, ${meeting.location}` : ""}).`;

    for (const userId of meetingPeople(meeting)) {
      const user = usersById.get(userId);
      if (!user) continue;
      const key = `meeting|${meeting.id}|${level}|${userId}`;
      if (await db.wasReminderSent(key)) continue;
      await notifyUser(user, config.email, `Meeting ${when}`, message, "/?go=meetings");
      await db.markReminderSent(key);
      // Larger points that were never reached for this person are now moot.
      for (const bigger of levels.filter((l) => l > level)) await db.markReminderSent(`meeting|${meeting.id}|${bigger}|${userId}`);
      sent += 1;
    }
  }
  return sent;
}

// ---------- Attendance reminder (everyone who hasn't marked attendance and isn't on leave) ----------

// The admin can change these in Settings. Days use JavaScript numbering: 0 = Sunday ... 6 = Saturday.
const ATTENDANCE_DEFAULTS = { enabled: true, time: "10:00", days: [1, 2, 3, 4, 5, 6] };
// If the server was asleep at the reminder time, it still reminds for this long after it wakes up.
const ATTENDANCE_CATCHUP_MINUTES = 4 * 60;

function localDateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function attendanceSettings(config) {
  const saved = config?.attendanceReminder || {};
  const time = /^([01]\d|2[0-3]):[0-5]\d$/.test(saved.time) ? saved.time : ATTENDANCE_DEFAULTS.time;
  const days = Array.isArray(saved.days) ? saved.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : ATTENDANCE_DEFAULTS.days;
  return { enabled: saved.enabled !== undefined ? !!saved.enabled : ATTENDANCE_DEFAULTS.enabled, time, days };
}

// Called every few minutes. Safe to call as often as you like: each person is reminded at most once a day,
// and only if today is a working day, the reminder time has passed, and they haven't marked attendance
// (or been marked on leave). `now` is a parameter so the rules can be tested.
async function runAttendanceReminderCheck(now = new Date()) {
  const config = await db.getConfig();
  const settings = attendanceSettings(config);
  if (!settings.enabled || !settings.days.includes(now.getDay())) return 0;

  const [hours, minutes] = settings.time.split(":").map(Number);
  const startMinute = hours * 60 + minutes;
  const nowMinute = now.getHours() * 60 + now.getMinutes();
  if (nowMinute < startMinute || nowMinute > startMinute + ATTENDANCE_CATCHUP_MINUTES) return 0;

  const dateKey = localDateKey(now);
  let reminded = 0;
  for (const user of await db.getUsers()) {
    const logKey = `attendance|${dateKey}|${user.id}`;
    if (await db.wasReminderSent(logKey)) continue;
    const entry = await db.getTrackerEntry(user.id, dateKey);
    if (entry && (entry.loginTime || entry.onLeave)) continue;
    await notifyUser(user, config.email, "Mark your attendance", "You haven't marked your attendance for today yet. Tap to open the app and mark it.", "/?go=tracker");
    await db.markReminderSent(logKey);
    reminded += 1;
  }
  return reminded;
}

module.exports = {
  runDailyReminderCheck, runTaskReminderCheck, runAttendanceReminderCheck, runMeetingReminderCheck,
  notifyTaskAssigned, notifyTaskDone, unreachableAssignees,
  notifyMeetingInvited, notifyMeetingCancelled, meetingStart,
  sendEmail, sendWhatsApp, sendPush, notifyUser,
  daysUntil,
};
