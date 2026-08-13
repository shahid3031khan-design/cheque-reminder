const nodemailer = require("nodemailer");
const db = require("./db");

const MILESTONES = [7, 3, 2, 1, 0]; // 1 week before, then daily for the last 3 days (+ due day)

function daysUntil(dateStr, today = new Date()) {
  const d = new Date(dateStr + "T00:00:00");
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((d - t) / 86400000);
}

function formatReminderMessage(cheque, daysLeft, currencySymbol) {
  const when =
    daysLeft === 7 ? `in 1 week (on ${cheque.depositDate})` :
    daysLeft === 0 ? `TODAY (${cheque.depositDate})` :
    `in ${daysLeft} day(s) (on ${cheque.depositDate})`;
  const numPart = cheque.chequeNumber ? ` (Cheque #${cheque.chequeNumber})` : "";
  const propPart = cheque.propertyDetail ? ` for ${cheque.propertyDetail}` : "";
  return `Cheque Reminder: ${cheque.tenantName} -> ${cheque.ownerName}${propPart} - ${currencySymbol}${cheque.amount}${numPart} is due for deposit ${when}.`;
}

async function sendEmail(emailConfig, subject, body) {
  try {
    const transport = nodemailer.createTransport({
      host: emailConfig.smtpHost,
      port: emailConfig.smtpPort,
      secure: false,
      auth: { user: emailConfig.smtpUser, pass: emailConfig.smtpAppPassword },
    });
    await transport.sendMail({ from: emailConfig.smtpUser, to: emailConfig.to, subject, text: body });
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

async function runDailyReminderCheck() {
  const config = await db.getConfig();
  const allCheques = await db.getCheques();
  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);

  for (const cheque of allCheques) {
    if (cheque.status === "deposited" || cheque.status === "bounced") continue;
    const daysLeft = daysUntil(cheque.depositDate, today);
    if (!MILESTONES.includes(daysLeft)) continue;

    const logKey = `${cheque.id}|${daysLeft}|${todayKey}`;
    if (await db.wasReminderSent(logKey)) continue;

    const message = formatReminderMessage(cheque, daysLeft, config.currencySymbol || "");
    const title = daysLeft === 0 ? "Cheque due TODAY" : daysLeft <= 3 ? `Cheque due in ${daysLeft} day(s)` : "Cheque due in 1 week";

    if (config.email?.enabled) await sendEmail(config.email, title, message);
    if (config.whatsapp?.enabled) await sendWhatsApp(config.whatsapp, message);
    if (config.push?.enabled) await sendPush(config.push, title, message);

    await db.markReminderSent(logKey);
    console.log(`[${todayKey}] ${message}`);
  }
}

module.exports = { runDailyReminderCheck, sendEmail, sendWhatsApp, sendPush, daysUntil };
