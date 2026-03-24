import admin from "firebase-admin";

const normalize = (value) => (value || "").toString().trim();

const getProjectId = () =>
  normalize(process.env.FIREBASE_PROJECT_ID) ||
  normalize(process.env.VITE_FIREBASE_PROJECT_ID);

const getClientEmail = () =>
  normalize(process.env.FIREBASE_CLIENT_EMAIL);

const getPrivateKey = () => {
  let raw = normalize(process.env.FIREBASE_PRIVATE_KEY);
  if (!raw) return "";

  // Strip JSON field name prefix if someone pasted the whole JSON line
  // e.g.  "private_key": "-----BEGIN PRIVATE KEY-----\n..."
  //  or   private_key": "-----BEGIN PRIVATE KEY-----\n..."
  raw = raw.replace(/^"?\s*private_key"?\s*:\s*"?/, "");

  // Strip trailing quote if present
  if (raw.endsWith('"')) {
    raw = raw.slice(0, -1);
  }

  // If the value is JSON-stringified (e.g. "\"-----BEGIN...\""), unwrap it
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try { raw = JSON.parse(raw); } catch { /* use as-is */ }
  }

  // Replace escaped newlines with real newlines
  raw = raw.replace(/\\n/g, "\n");

  // If it was Base64 encoded decode it
  if (!raw.includes("-----BEGIN") && raw.length > 100) {
    try { raw = Buffer.from(raw, "base64").toString("utf8"); } catch { /* use as-is */ }
  }

  return raw;
};

export const getAdminApp = () => {
  if (!admin.apps.length) {
    const projectId = getProjectId();
    const clientEmail = getClientEmail();
    const privateKey = getPrivateKey();

    console.log("[firebaseAdmin] init check:", {
      hasProjectId: Boolean(projectId),
      hasClientEmail: Boolean(clientEmail),
      hasPrivateKey: Boolean(privateKey),
      privateKeyStart: privateKey ? privateKey.substring(0, 30) + "..." : "<empty>"
    });

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        `Missing Firebase Admin credentials: projectId=${Boolean(projectId)}, clientEmail=${Boolean(clientEmail)}, privateKey=${Boolean(privateKey)}`
      );
    }

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        clientEmail,
        privateKey
      })
    });
  }

  return admin.app();
};

export const getAdminDb = () => admin.firestore(getAdminApp());
export const getAdminAuth = () => admin.auth(getAdminApp());
export const FieldValue = admin.firestore.FieldValue;
export const Timestamp = admin.firestore.Timestamp;

