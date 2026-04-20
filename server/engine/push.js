/**
 * Web Push helper.
 *
 * Design notes:
 * - VAPID keys come from env; if missing, push is a silent no-op (so the app still runs).
 * - pushToUser(userId, payload) fans out to every subscription the user has registered
 *   (one per browser install). Dead subscriptions (410 / 404) are pruned automatically.
 * - Call sites don't await individual sends — they fire-and-forget inside matchOrders /
 *   settleContract, so slow push deliveries never block trading.
 */
const db = require('../db');

let webpush = null;
let configured = false;

function configure() {
  if (configured) return !!webpush;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const contact = process.env.VAPID_CONTACT || 'mailto:admin@pitchpulse.local';
  if (!pub || !priv) {
    console.warn('[push] VAPID keys not set — push notifications disabled.');
    configured = true;
    return false;
  }
  try {
    webpush = require('web-push');
    webpush.setVapidDetails(contact, pub, priv);
    console.log('[push] Web push configured.');
  } catch (e) {
    console.warn('[push] web-push module unavailable:', e.message);
    webpush = null;
  }
  configured = true;
  return !!webpush;
}

const getByUser = db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?');
const delByEndpoint = db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?');

async function pushToUser(userId, payload) {
  if (!configure()) return;
  const rows = getByUser.all(userId);
  if (rows.length === 0) return;
  const body = JSON.stringify(payload);
  await Promise.all(rows.map(async (row) => {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        body,
      );
    } catch (e) {
      // 404/410 = subscription permanently gone; prune it.
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        delByEndpoint.run(row.endpoint);
      } else {
        console.warn('[push] send failed (user', userId + '):', e?.statusCode, e?.body || e?.message);
      }
    }
  }));
}

module.exports = { pushToUser, configure };
