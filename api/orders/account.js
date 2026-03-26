import { getAdminDb } from "../_lib/firebaseAdmin.js";
import { normalizeEmail, requireUser } from "../_lib/auth.js";
import { sanitizeOrderForClient, isOrderExpired } from "../_lib/orders.js";

const byNewest = (a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0);

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).setHeader("Allow", "GET").json({ error: "Method Not Allowed" });
    return;
  }

  const decoded = await requireUser(req, res);
  if (!decoded) return;

  try {
    const db = getAdminDb();
    const uid = (decoded.uid || "").toString().trim();
    const email = normalizeEmail(decoded.email || "");

    const [byUidSnap, byEmailSnap] = await Promise.all([
      db.collection("orders").where("userId", "==", uid).limit(80).get(),
      email
        ? db.collection("orders").where("userEmail", "==", email).limit(80).get()
        : Promise.resolve({ docs: [] })
    ]);

    const map = new Map();
    byUidSnap.docs.forEach((snap) => {
      const data = snap.data();
      if (!isOrderExpired(data)) {
        map.set(snap.id, sanitizeOrderForClient(snap.id, data));
      }
    });
    byEmailSnap.docs.forEach((snap) => {
      const data = snap.data();
      if (!isOrderExpired(data)) {
        map.set(snap.id, sanitizeOrderForClient(snap.id, data));
      }
    });

    const orders = Array.from(map.values()).sort(byNewest);
    res.status(200).json({ orders });
  } catch (err) {
    console.error("[orders/account] failed", err);
    res.status(500).json({ error: "Unable to load account orders." });
  }
}

