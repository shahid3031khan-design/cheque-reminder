const nodemailer = require("nodemailer");
const db = require("./db");

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
  return `Cheque Reminder: ${cheque.tenantName} -> ${cheque.ownerName}${propPart} - ${currencySymbol}${cheque.amount}${numPart} is due for deposit ${when}.`;
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
async function notifyUser(user, smtpConfig, title, message) {
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

// ---------- Cheque due-date reminders (everyone with a channel enabled) ----------

async function runDailyReminderCheck() {
  const config = await db.getConfig();
  const allCheques = await db.getCheques();
  const allUsers = await db.getUsers();
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);

  for (const cheque of allCheques) {
    if (cheque.status === "deposited" || cheque.status === "bounced") continue;
    const daysLeft = daysUntil(cheque.depositDate, today);
    if (!MILESTONES.includes(daysLeft)) continue;

    const message = formatChequeMessage(cheque, daysLeft, config.currencySymbol || "");
    const title = daysLeft === 0 ? "Cheque due TODAY" : daysLeft <= 3 ? `Cheque due in ${daysLeft} day(s)` : "Cheque due in 1 week";

    for (const user of allUsers) {
      const logKey = `cheque|${cheque.id}|${daysLeft}|${todayKey}|${user.id}`;
      if (await db.wasReminderSent(logKey)) continue;
      await notifyUser(user, config.email, title, message);
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
      const message = `Task Reminder: "${task.title}" is due ${when} (${task.dueDate}).`;
      const title = daysLeft === 0 ? "Task due today" : "Task due tomorrow";
      for (const userId of task.assignedTo || []) {
        const user = usersById.get(userId);
        if (!user) continue;
        const logKey = `task-due|${task.id}|${daysLeft}|${todayKey}|${userId}`;
        if (await db.wasReminderSent(logKey)) continue;
        await notifyUser(user, config.email, title, message);
        await db.markReminderSent(logKey);
      }
    }

    if (daysLeft < 0) {
      const statusLabel = task.status === "in_progress" ? "in progress" : "not started";
      const message = `Task Overdue: "${task.title}" was due on ${task.dueDate} and is still ${statusLabel}.`;
      for (const admin of admins) {
        const logKey = `task-overdue|${task.id}|${todayKey}|${admin.id}`;
        if (await db.wasReminderSent(logKey)) continue;
        await notifyUser(admin, config.email, "Task overdue", message);
        await db.markReminderSent(logKey);
      }
    }
  }
}

// ---------- Immediate task notifications (fired from the API routes, not the cron) ----------

async function notifyTaskAssigned(task, assignedBy, allUsers) {
  const config = await db.getConfig();
  const usersById = new Map(allUsers.map((u) => [u.id, u]));
  const message = `${assignedBy.displayName || assignedBy.username} assigned you a new task: "${task.title}"${task.dueDate ? ` (due ${task.dueDate})` : ""}.`;
  for (const userId of task.assignedTo || []) {
    const user = usersById.get(userId);
    if (!user) continue;
    await notifyUser(user, config.email, "New task assigned", message);
  }
}

async function notifyTaskDone(task, actingUser, allUsers) {
  const config = await db.getConfig();
  const message = `Task "${task.title}" was marked done by ${actingUser.displayName || actingUser.username}.`;
  const admins = allUsers.filter((u) => u.role === "admin" && u.id !== actingUser.id);
  for (const admin of admins) {
    await notifyUser(admin, config.email, "Task completed", message);
  }
}

module.exports = {
  runDailyReminderCheck, runTaskReminderCheck,
  notifyTaskAssigned, notifyTaskDone,
  sendEmail, sendWhatsApp, sendPush, notifyUser,
  daysUntil,
};
