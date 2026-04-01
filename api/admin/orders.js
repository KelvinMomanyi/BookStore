import { getAdminDb } from "../_lib/firebaseAdmin.js";
import { requireAdmin } from "../_lib/auth.js";
import { sanitizeOrderForClient } from "../_lib/orders.js";

const byNewest = (a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0);

export default async function handler(req, res) {
  const adminToken = await requireAdmin(req, res);
  if (!adminToken) return;

  if (req.method !== "GET") {
    res.status(405).setHeader("Allow", "GET").json({
      error: "Method Not Allowed"
    });
    return;
  }

  try {
    const db = getAdminDb();
    const snapshot = await db
      .collection("orders")
      .orderBy("createdAt", "desc")
      .limit(400)
      .get();

    const orders = snapshot.docs
      .map((snap) => sanitizeOrderForClient(snap.id, snap.data() || {}))
      .sort(byNewest);

    res.status(200).json({ orders });
  } catch (err) {
    console.error("[admin/orders] failed", err);
    res.status(500).json({ error: "Admin orders request failed." });
  }
}
