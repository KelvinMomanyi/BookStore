import { FieldValue, getAdminDb } from "../_lib/firebaseAdmin.js";
import { normalizeEmail, parseBody, requireUser } from "../_lib/auth.js";
import {
  hasOwner,
  isOwner,
  isPaymentConfirmed,
  sanitizeOrderForClient
} from "../_lib/orders.js";

const normalize = (value) => (value || "").toString().trim();

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).setHeader("Allow", "POST").json({ error: "Method Not Allowed" });
    return;
  }

  const decoded = await requireUser(req, res);
  if (!decoded) return;

  const body = parseBody(req);
  const orderId = normalize(body.orderId);
  const source = normalize(body.source || "order-id");
  const claimIfUnassigned = body.claimIfUnassigned !== false;

  if (!orderId) {
    res.status(400).json({ error: "Order ID is required." });
    return;
  }

  try {
    const db = getAdminDb();
    const orderRef = db.collection("orders").doc(orderId);
    const snap = await orderRef.get();

    if (!snap.exists) {
      res.status(404).json({ error: "Order not found." });
      return;
    }

    let data = snap.data() || {};

    if (!isOwner(data, decoded)) {
      if (!claimIfUnassigned || hasOwner(data)) {
        res.status(403).json({ error: "This order belongs to a different account." });
        return;
      }

      if (source !== "mpesa-code" && !isPaymentConfirmed(data)) {
        res.status(409).json({
          error: "Order is unassigned and payment is not confirmed yet."
        });
        return;
      }

      const uid = (decoded.uid || "").toString().trim();
      const email = normalizeEmail(decoded.email || "");

      await orderRef.update({
        userId: uid,
        userEmail: email,
        linkedAt: FieldValue.serverTimestamp()
      });

      const claimedSnap = await orderRef.get();
      data = claimedSnap.data() || data;
    }

    res.status(200).json({ order: sanitizeOrderForClient(snap.id, data) });
  } catch (err) {
    console.error("[orders/by-id] failed", err);
    res.status(500).json({ error: "Unable to load order." });
  }
}

