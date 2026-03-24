import { FieldValue, getAdminDb } from "../_lib/firebaseAdmin.js";
import { normalizeEmail, parseBody, requireUser } from "../_lib/auth.js";
import {
  hasOwner,
  isOwner,
  isPaymentConfirmed,
  normalizeTransactionCode,
  sanitizeOrderForClient
} from "../_lib/orders.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).setHeader("Allow", "POST").json({ error: "Method Not Allowed" });
    return;
  }

  const decoded = await requireUser(req, res);
  if (!decoded) return;

  const body = parseBody(req);
  const code = normalizeTransactionCode(body.code);
  if (!code) {
    res.status(400).json({ error: "Transaction code is required." });
    return;
  }

  try {
    const db = getAdminDb();
    const attempts = [...new Set([code, code.toLowerCase()])];
    const map = new Map();

    for (const value of attempts) {
      const snap = await db
        .collection("orders")
        .where("payment.transactionId", "==", value)
        .limit(12)
        .get();
      snap.docs.forEach((docSnap) => {
        map.set(docSnap.id, docSnap);
      });
    }

    if (!map.size) {
      res.status(404).json({ error: "No payment found for this transaction code." });
      return;
    }

    let matched = null;
    let unassignedCandidate = null;

    for (const docSnap of map.values()) {
      const data = docSnap.data() || {};
      const tx = normalizeTransactionCode(data?.payment?.transactionId || "");
      if (tx !== code) continue;

      if (isOwner(data, decoded)) {
        matched = { id: docSnap.id, data };
        break;
      }

      if (!hasOwner(data)) {
        unassignedCandidate = { id: docSnap.id, data };
      }
    }

    if (!matched && unassignedCandidate) {
      const orderRef = db.collection("orders").doc(unassignedCandidate.id);
      if (!isPaymentConfirmed(unassignedCandidate.data)) {
        res.status(409).json({
          error: "Order found but payment is not confirmed yet."
        });
        return;
      }

      await orderRef.update({
        userId: decoded.uid,
        userEmail: normalizeEmail(decoded.email || ""),
        linkedAt: FieldValue.serverTimestamp()
      });
      const claimedSnap = await orderRef.get();
      matched = { id: claimedSnap.id, data: claimedSnap.data() || {} };
    }

    if (!matched) {
      res.status(403).json({
        error: "No payment linked to your account was found for that transaction code."
      });
      return;
    }

    res.status(200).json({ order: sanitizeOrderForClient(matched.id, matched.data) });
  } catch (err) {
    console.error("[orders/by-transaction] failed", err);
    res.status(500).json({ error: "Unable to verify transaction code." });
  }
}
