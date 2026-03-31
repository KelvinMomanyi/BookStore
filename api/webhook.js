import admin from "firebase-admin";

const normalize = (value) => (value || "").toString().trim().toLowerCase();

const isPaidStatus = (value) => {
  const status = normalize(value);
  return [
    "paid",
    "success",
    "completed",
    "confirmed",
    "payment.success",
    "payment_success",
    "payment_confirmed"
  ].includes(status);
};

const isFailedStatus = (value) => {
  const status = normalize(value);
  return [
    "failed",
    "cancelled",
    "canceled",
    "timeout",
    "expired",
    "payment.failed",
    "payment_failed",
    "payment.cancelled",
    "payment.canceled",
    "payment_cancelled",
    "payment_canceled"
  ].includes(status);
};

const parseBody = (req) => {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return { raw: req.body };
    }
  }

  return {};
};

const readCallbackMetadata = (payload, name) => {
  const items =
    payload?.CallbackMetadata?.Item ||
    payload?.Body?.stkCallback?.CallbackMetadata?.Item ||
    [];

  const match = Array.isArray(items)
    ? items.find((item) => normalize(item?.Name) === normalize(name))
    : null;

  return match?.Value ?? null;
};

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const extractPaymentInfo = (payload) => {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : {};
  const stkCallback = payload?.Body?.stkCallback || payload?.stkCallback || {};
  const eventName =
    payload?.event ??
    payload?.Event ??
    data?.event ??
    data?.Event ??
    payload?.eventName ??
    payload?.event_name ??
    data?.eventName ??
    data?.event_name ??
    payload?.type ??
    data?.type ??
    null;
  const gatewayStatus =
    payload?.status ??
    data?.status ??
    payload?.paymentStatus ??
    payload?.payment_status ??
    data?.paymentStatus ??
    data?.payment_status ??
    eventName ??
    null;

  const resultCode =
    payload?.ResultCode ??
    payload?.resultCode ??
    payload?.result_code ??
    data?.ResultCode ??
    data?.resultCode ??
    data?.result_code ??
    stkCallback?.ResultCode ??
    null;
  const resultDesc =
    payload?.ResultDesc ??
    payload?.resultDesc ??
    data?.ResultDesc ??
    data?.resultDesc ??
    stkCallback?.ResultDesc ??
    "";
  const checkoutRequestId =
    payload?.CheckoutRequestID ||
    payload?.checkoutRequestId ||
    payload?.checkout_request_id ||
    data?.CheckoutRequestID ||
    data?.checkoutRequestId ||
    data?.checkout_request_id ||
    stkCallback?.CheckoutRequestID ||
    null;
  const merchantRequestId =
    payload?.MerchantRequestID ||
    payload?.merchantRequestId ||
    payload?.merchant_request_id ||
    data?.MerchantRequestID ||
    data?.merchantRequestId ||
    data?.merchant_request_id ||
    stkCallback?.MerchantRequestID ||
    null;
  const accountReference =
    payload?.AccountReference ||
    payload?.accountReference ||
    payload?.account_reference ||
    data?.AccountReference ||
    data?.accountReference ||
    data?.account_reference ||
    payload?.reference ||
    data?.reference ||
    null;
  const transactionId =
    payload?.transaction_id ||
    payload?.transactionId ||
    payload?.MpesaReceiptNumber ||
    payload?.mpesaReceiptNumber ||
    payload?.mpesa_receipt_number ||
    data?.transaction_id ||
    data?.transactionId ||
    data?.MpesaReceiptNumber ||
    data?.mpesaReceiptNumber ||
    data?.mpesa_receipt_number ||
    readCallbackMetadata(payload, "MpesaReceiptNumber") ||
    readCallbackMetadata(payload, "M_PESA_RECEIPT_NUMBER") ||
    null;
  const amount = toNumberOrNull(
    payload?.Amount ??
      payload?.amount ??
      payload?.data?.amount ??
      data?.Amount ??
      readCallbackMetadata(payload, "Amount") ??
      null
  );
  const phoneNumber =
    payload?.PhoneNumber ??
    payload?.phoneNumber ??
    payload?.phone ??
    payload?.msisdn ??
    data?.PhoneNumber ??
    data?.phoneNumber ??
    data?.phone ??
    data?.msisdn ??
    readCallbackMetadata(payload, "PhoneNumber") ??
    null;
  const failureReason =
    payload?.failure_reason ||
    payload?.failureReason ||
    data?.failure_reason ||
    data?.failureReason ||
    payload?.reason ||
    data?.reason ||
    resultDesc ||
    "";

  return {
    resultCode,
    resultDesc,
    eventName,
    gatewayStatus,
    checkoutRequestId,
    merchantRequestId,
    accountReference,
    transactionId,
    amount,
    phoneNumber,
    failureReason
  };
};

const isSuccessResult = (resultCode, gatewayStatus = "", eventName = "") => {
  if (resultCode === 0 || resultCode === "0") return true;
  const normalizedResult = normalize(resultCode);
  const status = normalize(gatewayStatus);
  const event = normalize(eventName);

  return (
    normalizedResult === "success" ||
    normalizedResult === "paid" ||
    status === "success" ||
    status === "paid" ||
    status === "payment.success" ||
    status === "payment_success" ||
    status === "payment_confirmed" ||
    event === "success" ||
    event === "paid" ||
    event === "payment.success" ||
    event === "payment_success" ||
    event === "payment_confirmed"
  );
};

const isCancelledResult = (resultCode, gatewayStatus = "", eventName = "") => {
  const status = normalize(gatewayStatus);
  const event = normalize(eventName);
  return (
    resultCode === 1032 ||
    resultCode === "1032" ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "payment.cancelled" ||
    status === "payment.canceled" ||
    status === "payment_cancelled" ||
    status === "payment_canceled" ||
    event.includes("cancel")
  );
};

const isFailureResult = (resultCode, gatewayStatus = "", eventName = "") => {
  if (isCancelledResult(resultCode, gatewayStatus, eventName)) return true;

  const status = normalize(gatewayStatus);
  const event = normalize(eventName);
  if (
    status === "failed" ||
    status === "error" ||
    status === "timeout" ||
    status === "expired" ||
    status === "payment.failed" ||
    status === "payment_failed" ||
    event === "failed" ||
    event === "error" ||
    event === "timeout" ||
    event === "payment.failed" ||
    event === "payment_failed"
  ) {
    return true;
  }

  return (
    resultCode !== null &&
    resultCode !== undefined &&
    resultCode !== 0 &&
    resultCode !== "0"
  );
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const expectedToken = process.env.XECO_WEBHOOK_TOKEN;
  if (expectedToken) {
    const provided =
      req.query?.token ||
      req.headers["x-xeco-token"] ||
      req.headers["x-webhook-token"];
    if (provided !== expectedToken) {
      return res.status(401).send("Unauthorized");
    }
  }

  const payload = parseBody(req);
  const info = extractPaymentInfo(payload);

  try {
    if (!admin.apps.length) {
      if (!process.env.FIREBASE_CLIENT_EMAIL || !process.env.FIREBASE_PRIVATE_KEY) {
        throw new Error("Firebase credentials missing in Vercel environment variables.");
      }

      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.VITE_FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
        })
      });
    }

    const db = admin.firestore();
    const FieldValue = admin.firestore.FieldValue;
    let orderRef = null;

    if (info.accountReference) {
      const potentialRef = db.collection("orders").doc(info.accountReference);
      const snap = await potentialRef.get();
      if (snap.exists) {
        orderRef = potentialRef;
      }
    }

    if (!orderRef && info.checkoutRequestId) {
      const snapshot = await db
        .collection("orders")
        .where("payment.checkoutRequestId", "==", info.checkoutRequestId)
        .limit(1)
        .get();
      if (!snapshot.empty) {
        orderRef = snapshot.docs[0].ref;
      }
    }

    if (!orderRef && info.merchantRequestId) {
      const snapshot = await db
        .collection("orders")
        .where("payment.merchantRequestId", "==", info.merchantRequestId)
        .limit(1)
        .get();
      if (!snapshot.empty) {
        orderRef = snapshot.docs[0].ref;
      }
    }

    if (!orderRef) {
      console.warn("[WEBHOOK] No matching order found for payload:", info);
      return res.status(200).json({ received: true, matched: false });
    }

    const snap = await orderRef.get();
    if (!snap.exists) {
      return res.status(200).json({ received: true, matched: false });
    }

    const current = snap.data() || {};
    const currentStatus = normalize(current.status);
    const isSuccess = isSuccessResult(
      info.resultCode,
      info.gatewayStatus,
      info.eventName
    );
    const isFailure = isFailureResult(
      info.resultCode,
      info.gatewayStatus,
      info.eventName
    );
    const isCancelled = isCancelledResult(
      info.resultCode,
      info.gatewayStatus,
      info.eventName
    );

    const updates = {
      "payment.gatewayStatus": isSuccess
        ? "success"
        : isFailure
          ? isCancelled
            ? "cancelled"
            : "failed"
          : normalize(info.gatewayStatus) || "pending",
      "payment.resultCode": info.resultCode ?? null,
      "payment.resultDesc": info.resultDesc || info.failureReason || "",
      "payment.transactionId": info.transactionId || "",
      "payment.phoneNumber": info.phoneNumber || "",
      "payment.amount": info.amount ?? null,
      "payment.updatedAt": FieldValue.serverTimestamp()
    };

    const amountMismatch =
      typeof info.amount === "number" &&
      typeof current.total === "number" &&
      Math.abs(info.amount - current.total) > 0.01;

    if (amountMismatch) {
      updates["payment.amountMismatch"] = true;
      updates["payment.amountExpected"] = current.total;
      updates.status = "review";
    } else if (isSuccess) {
      if (!isPaidStatus(currentStatus)) {
        updates.status = "paid";
        updates.paidAt = FieldValue.serverTimestamp();
      }
    } else if (isFailure) {
      if (!isFailedStatus(currentStatus)) {
        updates.status = isCancelled ? "cancelled" : "failed";
        updates.failureReason =
          info.failureReason ||
          info.resultDesc ||
          (isCancelled ? "Payment cancelled" : "Payment failed");
      }
    }

    await orderRef.update(updates);
    console.info("[WEBHOOK] Order updated successfully:", orderRef.id);
    return res.status(200).json({ received: true, matched: true });
  } catch (err) {
    console.error("[WEBHOOK] Processing Error:", err.message);
    return res.status(500).json({
      received: false,
      error: "Webhook processing failed"
    });
  }
}
