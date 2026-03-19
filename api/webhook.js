import admin from "firebase-admin";

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.VITE_FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    }),
  });
}

const db = admin.firestore();

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
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  // Optional: Security token validation (if you set XECO_WEBHOOK_TOKEN in Vercel)
  const expectedToken = process.env.XECO_WEBHOOK_TOKEN;
  if (expectedToken) {
    const provided = req.query?.token || req.headers["x-xeco-token"] || req.headers["x-webhook-token"];
    if (provided !== expectedToken) {
      return res.status(401).send("Unauthorized");
    }
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

  let orderRef = null;

  // 1. Try match by accountReference (trimmed to 12 in frontend)
  if (info.accountReference) {
    const potentialRef = db.collection("orders").doc(info.accountReference);
    const snap = await potentialRef.get();
    if (snap.exists) {
      orderRef = potentialRef;
    }
  }

  // 2. Fallback to query by checkoutRequestId
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
    console.warn("No matching order found for payload", info);
    return res.status(200).json({ received: true, matched: false });
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
  return res.status(200).json({ received: true, matched: true });
}
