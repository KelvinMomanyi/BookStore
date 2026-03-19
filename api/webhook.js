import admin from "firebase-admin";

const normalize = (value) => (value || "").toString().trim().toLowerCase();

const isPaidStatus = (value) => {
  const status = normalize(value);
  return ["paid", "success", "completed", "confirmed", "payment_success"].includes(status);
};

const isSuccessResult = (resultCode) => {
  if (resultCode === 0 || resultCode === "0") return true;
  const normalized = normalize(resultCode);
  return normalized === "success" || normalized === "paid";
};

export default async function handler(req, res) {
  // Always acknowledge the request immediately to satisfy the gateway
  if (req.method === "POST") {
    console.log("[WEBHOOK] Gateway request received. Sending early ACK.");
    res.status(200).json({ received: true, ack: true });
  } else {
    return res.status(405).send("Method Not Allowed");
  }

  const payload = req.body || {};
  const stkCallback = payload?.Body?.stkCallback || payload?.stkCallback || {};
  
  const info = {
    resultCode: payload?.ResultCode ?? stkCallback?.ResultCode ?? null,
    resultDesc: payload?.ResultDesc ?? stkCallback?.ResultDesc ?? "",
    checkoutRequestId: payload?.CheckoutRequestID || stkCallback?.CheckoutRequestID || payload?.checkoutRequestId || null,
    merchantRequestId: payload?.MerchantRequestID || stkCallback?.MerchantRequestID || payload?.merchantRequestId || null,
    accountReference: payload?.AccountReference || payload?.accountReference || null,
    amount: payload?.Amount || payload?.amount || null,
  };

  try {
    // 1. Initialize Firebase Admin safely inside the handler
    if (!admin.apps.length) {
      if (!process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
        throw new Error("Firebase credentials missing in Vercel environment variables.");
      }
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.VITE_FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
        }),
      });
    }

    const db = admin.firestore();
    let orderRef = null;

    // 2. Try match by accountReference (trimmed to 12 in frontend)
    if (info.accountReference) {
      const potentialRef = db.collection("orders").doc(info.accountReference);
      const snap = await potentialRef.get();
      if (snap.exists) {
        orderRef = potentialRef;
      }
    }

    // 3. Fallback to query by checkoutRequestId
    if (!orderRef && info.checkoutRequestId) {
      const snapshot = await db.collection("orders")
        .where("payment.checkoutRequestId", "==", info.checkoutRequestId)
        .limit(1)
        .get();
      if (!snapshot.empty) {
        orderRef = snapshot.docs[0].ref;
      }
    }

    if (!orderRef) {
      console.warn("[WEBHOOK] No matching order found for payload:", info);
      return;
    }

    const isSuccess = isSuccessResult(info.resultCode);
    const updates = {
      "payment.gatewayStatus": isSuccess ? "success" : "failed",
      "payment.resultCode": info.resultCode,
      "payment.resultDesc": info.resultDesc,
      "payment.updatedAt": admin.firestore.FieldValue.serverTimestamp(),
    };

    if (isSuccess) {
      updates.status = "paid";
      updates.paidAt = admin.firestore.FieldValue.serverTimestamp();
    } else {
      updates.status = "failed";
      updates.failureReason = info.resultDesc || "Payment failed";
    }

    await orderRef.update(updates);
    console.info("[WEBHOOK] Order updated successfully:", orderRef.id);
  } catch (err) {
    console.error("[WEBHOOK] Processing Error:", err.message);
  }
}
