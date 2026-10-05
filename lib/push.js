const webpush = require("web-push");
const db = require("./db");

// Only real browser push services may be used as a subscription endpoint. Without this, any signed-in user
// could make the server send requests to an address of their choosing.
const PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com",          // Chrome / Edge / Samsung / Android
  "push.services.mozilla.com",   // Firefox
  "push.apple.com",              // Safari / iPhone home-screen apps
  "notify.windows.com",          // Edge on Windows
];

function isAllowedEndpoint(endpoint) {
  try {
    const url = new URL(String(endpoint));
    return url.protocol === "https:" && PUSH_HOST_SUFFIXES.some((suffix) => url.hostname === suffix || url.hostname.endsWith("." + suffix));
  } catch {
    return false;
  }
}

let ready = null;

// Loads (or, the first time, creates) the signing keys and configures the library.
function init() {
  if (!ready) {
    ready = (async () => {
      let keys = process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
        ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
        : await db.getVapidKeys();
      if (!keys) keys = await db.saveVapidKeysIfMissing(webpush.generateVAPIDKeys());
      webpush.setVapidDetails(process.env.PUSH_SUBJECT || "https://cheque-reminder-zmdg.onrender.com", keys.publicKey, keys.privateKey);
      return keys.publicKey;
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

async function publicKey() {
  return init();
}

// Sends one notification to every phone/browser this user has turned notifications on for.
// Returns how many were accepted. Phones that have uninstalled or revoked permission are cleaned up.
async function sendToUser(userId, { title, body, url = "/", tag }) {
  await init();
  const subscriptions = await db.getPushSubscriptions(userId);
  const payload = JSON.stringify({ title, body, url, tag });
  let sent = 0;
  for (const sub of subscriptions) {
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload, { TTL: 12 * 60 * 60 });
      sent += 1;
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) {
        await db.removePushSubscription(sub.endpoint);
      } else {
        console.warn("Phone push failed:", err.statusCode || err.message);
      }
    }
  }
  return sent;
}

module.exports = { isAllowedEndpoint, publicKey, sendToUser };
