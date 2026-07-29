/**
 * Firebase Realtime Database writer (Admin SDK).
 *
 * The RTDB rules deny anonymous writes, so results are written with a service
 * account instead of an anonymous REST PUT. Requires two env vars:
 *   FIREBASE_SERVICE_ACCOUNT  — the service-account JSON (as a string)
 *   FIREBASE_DATABASE_URL     — the RTDB URL
 * When they're not set (e.g. a local dry run) writes are skipped with a warning
 * rather than crashing the test.
 */
const admin = require('firebase-admin');

let _db = null;
let _tried = false;

function getDb() {
  if (_db || _tried) return _db;
  _tried = true;
  const url = (process.env.FIREBASE_DATABASE_URL || '').replace(/\/$/, '');
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || '';
  if (!url || !raw) return null;
  try {
    const creds = JSON.parse(raw);
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert(creds), databaseURL: url });
    }
    _db = admin.database();
  } catch (e) {
    console.error(`⚠️  Firebase init failed (check FIREBASE_SERVICE_ACCOUNT JSON): ${e.message}`);
    _db = null;
  }
  return _db;
}

// Overwrite the value at `path`. Returns true on success, false on failure.
async function fbSet(path, data) {
  const db = getDb();
  if (!db) {
    console.error(`⚠️  Firebase not configured (FIREBASE_SERVICE_ACCOUNT / FIREBASE_DATABASE_URL) — skipped ${path}`);
    return false;
  }
  try {
    await db.ref(path).set(data);
    return true;
  } catch (e) {
    console.error(`⚠️  Firebase write failed for ${path}: ${e.message}`);
    return false;
  }
}

module.exports = { fbSet };
