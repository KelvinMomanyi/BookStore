const { onRequest } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const admin = require("firebase-admin");
const { Readable } = require("stream");
const { pipeline } = require("stream/promises");

admin.initializeApp();

const normalize = (value) =>
  (value || "").toString().trim().toLowerCase();

const isPaidStatus = (value) => {
  const status = normalize(value);
  return (
    status === "paid" ||
    status === "success" ||
    status === "completed" ||
    status === "confirmed" ||
    status === "payment_success" ||
    status === "payment-confirmed"
  );
};

const isFailedStatus = (value) => {
  const status = normalize(value);
  return (
    status === "failed" ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "timeout" ||
    status === "expired" ||
    status === "payment_failed" ||
    status === "payment_cancelled"
  );
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

const extractPaymentInfo = (payload) => {
  const stkCallback = payload?.Body?.stkCallback || payload?.stkCallback || {};
  const resultCode =
    payload?.ResultCode ??
    payload?.resultCode ??
    stkCallback?.ResultCode ??
    null;
  const resultDesc =
    payload?.ResultDesc ?? payload?.resultDesc ?? stkCallback?.ResultDesc ?? "";
  const checkoutRequestId =
    payload?.CheckoutRequestID ||
    payload?.checkoutRequestId ||
    stkCallback?.CheckoutRequestID ||
    null;
  const merchantRequestId =
    payload?.MerchantRequestID ||
    payload?.merchantRequestId ||
    stkCallback?.MerchantRequestID ||
    null;
  const accountReference =
    payload?.AccountReference ||
    payload?.accountReference ||
    payload?.account_reference ||
    null;
  const receipt =
    payload?.MpesaReceiptNumber ||
    payload?.mpesaReceiptNumber ||
    payload?.mpesa_receipt_number ||
    readCallbackMetadata(payload, "MpesaReceiptNumber") ||
    readCallbackMetadata(payload, "M_PESA_RECEIPT_NUMBER") ||
    null;
  const amount =
    payload?.Amount ??
    payload?.amount ??
    readCallbackMetadata(payload, "Amount") ??
    null;
  const phoneNumber =
    payload?.PhoneNumber ??
    payload?.phoneNumber ??
    readCallbackMetadata(payload, "PhoneNumber") ??
    null;

  return {
    resultCode,
    resultDesc,
    checkoutRequestId,
    merchantRequestId,
    accountReference,
    receipt,
    amount,
    phoneNumber
  };
};

const isSuccessResult = (resultCode) => {
  if (resultCode === 0 || resultCode === "0") return true;
  const normalized = normalize(resultCode);
  return normalized === "success" || normalized === "paid";
};

exports.xecoWebhook = onRequest(async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  const expectedToken = process.env.XECO_WEBHOOK_TOKEN;
  if (expectedToken) {
    const provided =
      req.query?.token ||
      req.headers["x-xeco-token"] ||
      req.headers["x-webhook-token"];
    if (provided !== expectedToken) {
      res.status(401).send("Unauthorized");
      return;
    }
  }

  const payload = parseBody(req);
  const info = extractPaymentInfo(payload);
  const db = admin.firestore();
  const FieldValue = admin.firestore.FieldValue;

  let orderRef = null;

  // Try matching by document ID first
  if (info.accountReference) {
    const potentialRef = db.collection("orders").doc(info.accountReference);
    const snap = await potentialRef.get();
    if (snap.exists) {
      orderRef = potentialRef;
    }
  }

  // Fallback to searching by checkoutRequestId (most reliable for STK Push)
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

  // Final fallback to merchantRequestId
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
    logger.warn("Webhook received with no matching order", {
      checkoutRequestId: info.checkoutRequestId,
      merchantRequestId: info.merchantRequestId,
      accountReference: info.accountReference
    });
    res.status(200).json({ received: true, matched: false });
    return;
  }

  const snap = await orderRef.get();
  if (!snap.exists) {
    res.status(200).json({ received: true, matched: false });
    return;
  }

  const current = snap.data() || {};
  const currentStatus = normalize(current.status);

  const updates = {
    "payment.gatewayStatus": isSuccessResult(info.resultCode)
      ? "success"
      : "failed",
    "payment.resultCode": info.resultCode ?? null,
    "payment.resultDesc": info.resultDesc || "",
    "payment.transactionId": info.receipt || "",
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
  } else if (isSuccessResult(info.resultCode)) {
    if (!isPaidStatus(currentStatus)) {
      updates.status = "paid";
      updates.paidAt = FieldValue.serverTimestamp();
    }
  } else {
    if (!isFailedStatus(currentStatus)) {
      updates.status = "failed";
      updates.failureReason = info.resultDesc || "Payment failed";
    }
  }

  await orderRef.update(updates);
  res.status(200).json({ received: true, matched: true });
});

exports.downloadEbook = onRequest(async (req, res) => {
  const urlParam = req.query?.url;
  if (!urlParam) {
    res.status(400).send("Missing url parameter.");
    return;
  }

  let target;
  try {
    target = new URL(urlParam);
  } catch {
    res.status(400).send("Invalid url parameter.");
    return;
  }

  if (target.protocol !== "https:") {
    res.status(400).send("Only https URLs are allowed.");
    return;
  }

  if (target.hostname !== "res.cloudinary.com") {
    res.status(403).send("Host not allowed.");
    return;
  }

  const pathParts = target.pathname.split("/").filter(Boolean);
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (cloudName && pathParts[0] !== cloudName) {
    res.status(403).send("Cloud name not allowed.");
    return;
  }

  const filenameParam = req.query?.filename;
  const rawName = filenameParam
    ? filenameParam.toString()
    : pathParts[pathParts.length - 1] || "ebook";
  const safeName = rawName.replace(/["\\]/g, "").trim() || "ebook";

  try {
    const response = await fetch(target.toString());
    if (!response.ok) {
      res.status(response.status).send(`Upstream error: ${response.status}`);
      return;
    }

    const contentType =
      response.headers.get("content-type") || "application/octet-stream";
    const contentLength = response.headers.get("content-length");

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeName}"`
    );
    if (contentLength) {
      res.setHeader("Content-Length", contentLength);
    }

    if (!response.body) {
      res.status(502).send("Empty response body.");
      return;
    }

    const nodeStream = Readable.fromWeb(response.body);
    await pipeline(nodeStream, res);
  } catch (err) {
    logger.error("Download proxy failed", err);
    res.status(500).send("Download failed.");
  }
});
