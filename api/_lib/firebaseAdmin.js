import admin from "firebase-admin";

const normalize = (value) => (value || "").toString().trim();

const getProjectId = () =>
  normalize(process.env.FIREBASE_PROJECT_ID) ||
  normalize(process.env.VITE_FIREBASE_PROJECT_ID);

const getClientEmail = () =>
  normalize(process.env.FIREBASE_CLIENT_EMAIL);

const getPrivateKey = () =>
  normalize(process.env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, "\n");

export const getAdminApp = () => {
  if (!admin.apps.length) {
    const projectId = getProjectId();
    const clientEmail = getClientEmail();
    const privateKey = getPrivateKey();

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error("Missing Firebase Admin credentials in Vercel environment.");
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

