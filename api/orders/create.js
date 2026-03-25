import { FieldValue, getAdminDb } from "../_lib/firebaseAdmin.js";
import { normalizeEmail, parseBody, requireUser } from "../_lib/auth.js";

const normalize = (value) => (value || "").toString().trim();

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const sanitizeItem = (item) => ({
  bookId: normalize(item?.bookId || item?.id),
  title: normalize(item?.title),
  author: normalize(item?.author),
  price: Math.max(0, toNumber(item?.price, 0)),
  qty: Math.max(1, Math.floor(toNumber(item?.qty, 1))),
  coverUrl: normalize(item?.coverUrl),
  fileUrl: normalize(item?.fileUrl)
});

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).setHeader("Allow", "POST").json({ error: "Method Not Allowed" });
    return;
  }

  const decoded = await requireUser(req, res);
  if (!decoded) return;

  const body = parseBody(req);
  const phoneNumber = normalize(body.phoneNumber);
  const items = Array.isArray(body.items) ? body.items.map(sanitizeItem) : [];

  if (!phoneNumber) {
    res.status(400).json({ error: "Phone number is required." });
    return;
  }

  if (!items.length) {
    res.status(400).json({ error: "Cart is empty." });
    return;
  }

  if (items.some((item) => !item.bookId || !item.title)) {
    res.status(400).json({ error: "Invalid order items." });
    return;
  }

  const expectedTotal = items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const requestedTotal = Math.max(0, toNumber(body.total, expectedTotal));
  const total = Math.abs(expectedTotal - requestedTotal) < 0.01 ? requestedTotal : expectedTotal;

  try {
    const db = getAdminDb();
    const userId = (decoded.uid || "").toString().trim();
    const userEmail = normalizeEmail(decoded.email || "");

    const docRef = await db.collection("orders").add({
      userId,
      userEmail,
      phoneNumber,
      items,
      total,
      createdAt: FieldValue.serverTimestamp(),
      status: "pending",
      payment: {
        provider: "mpesa",
        status: "initiated"
      }
    });

    res.status(201).json({ id: docRef.id });
  } catch (err) {
    const errorMessage = (err?.message || "").toString();
    const errorCode = (err?.code || "").toString().toLowerCase();
    const normalized = errorMessage.toLowerCase();
    const permissionDenied =
      err?.code === 7 ||
      errorCode.includes("permission-denied") ||
      normalized.includes("permission denied") ||
      normalized.includes("insufficient permissions");

    console.error("[orders/create] failed", {
      message: errorMessage,
      code: err?.code,
      stack: err?.stack
    });

    if (permissionDenied) {
      res.status(500).json({
        error:
          "Unable to create order: server Firestore write permission is missing. Ensure FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY belong to a service account with Firestore access."
      });
      return;
    }

    res.status(500).json({ error: `Unable to create order: ${errorMessage || "unknown error"}` });
  }
}
