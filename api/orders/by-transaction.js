import { FieldValue, getAdminDb } from "../_lib/firebaseAdmin.js";
import { normalizeEmail, parseBody, requireUser } from "../_lib/auth.js";
import {
  hasOwner,
  isFailedStatus,
  isOwner,
  isPaidStatus,
  isPaymentConfirmed,
  normalizeStatus,
  normalizeTransactionCode,
  sanitizeOrderForClient,
  isOrderExpired
} from "../_lib/orders.js";
import {
  XecoflowRequestError,
  buildXecoflowByReceiptUrl,
  getMissingXecoflowConfig,
  requestXecoflowJson
} from "../_lib/xecoflow.js";

const normalize = (value) => (value || "").toString().trim().toLowerCase();

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const pickTransactionPayload = (response) => {
  if (response && typeof response === "object" && response.data) {
    return response.data;
  }
  return response;
};

const normalizeGatewayStatusFromXecoflow = (status, resultCode) => {
  const normalized = normalize(status).replace(/[\s-]+/g, "_");
  if (
    resultCode === 0 ||
    resultCode === "0" ||
    [
      "payment_success",
      "payment.success",
      "success",
      "paid",
      "completed",
      "confirmed"
    ].includes(normalized)
  ) {
    return "success";
  }
  if (
    [
      "pending_payment",
      "pending",
      "requested",
      "initiated",
      "processing",
      "queued"
    ].includes(normalized)
  ) {
    return "pending";
  }
  if (
    normalized === "payment_failed" ||
    normalized === "payment.failed" ||
    normalized === "failed" ||
    normalized === "error" ||
    normalized === "timeout" ||
    normalized === "expired"
  ) {
    return "failed";
  }
  if (normalized.includes("cancel")) {
    return "cancelled";
  }
  return normalized || "pending";
};

const isCancelledTransaction = (transaction) => {
  const combined = [
    transaction?.status,
    transaction?.failure_reason,
    transaction?.failure_category,
    transaction?.result_description
  ]
    .map((value) => normalize(value))
    .join(" ");

  return (
    transaction?.result_code === 1032 ||
    transaction?.result_code === "1032" ||
    combined.includes("cancel")
  );
};

const getFailureReason = (transaction) =>
  transaction?.failure_reason ||
  transaction?.result_description ||
  (isCancelledTransaction(transaction)
    ? "Payment cancelled"
    : "Payment failed");

const findByTransactionCode = async (db, code) => {
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

  return map;
};

const claimOrder = async (db, orderId, decoded) => {
  const orderRef = db.collection("orders").doc(orderId);
  await orderRef.update({
    userId: decoded.uid,
    userEmail: normalizeEmail(decoded.email || ""),
    linkedAt: FieldValue.serverTimestamp()
  });
  const claimedSnap = await orderRef.get();
  return { id: claimedSnap.id, data: claimedSnap.data() || {} };
};

const getMatchedLocalOrder = async (db, code, decoded) => {
  const map = await findByTransactionCode(db, code);
  if (!map.size) return { matched: null, pendingUnassigned: null, hasForeignOwned: false };

  let matched = null;
  let pendingUnassigned = null;
  let hasForeignOwned = false;

  for (const docSnap of map.values()) {
    const data = docSnap.data() || {};
    const tx = normalizeTransactionCode(data?.payment?.transactionId || "");
    if (tx !== code) continue;

    if (isOwner(data, decoded)) {
      matched = { id: docSnap.id, data };
      break;
    }

    if (!hasOwner(data)) {
      if (isPaymentConfirmed(data)) {
        matched = await claimOrder(db, docSnap.id, decoded);
        break;
      }
      pendingUnassigned = { id: docSnap.id, data };
      continue;
    }

    hasForeignOwned = true;
  }

  return { matched, pendingUnassigned, hasForeignOwned };
};

const findOrderByCheckoutRequestId = async (db, checkoutRequestId) => {
  if (!checkoutRequestId) return null;
  const snap = await db
    .collection("orders")
    .where("payment.checkoutRequestId", "==", checkoutRequestId)
    .limit(1)
    .get();

  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  return { id: docSnap.id, data: docSnap.data() || {} };
};

const updateOrderFromTransaction = async (db, orderEntry, transaction, fallbackCode) => {
  const orderRef = db.collection("orders").doc(orderEntry.id);
  const current = orderEntry.data || {};

  const receiptCode = normalizeTransactionCode(
    transaction?.mpesa_receipt || transaction?.transaction_id || fallbackCode
  );
  const checkoutRequestId =
    (transaction?.checkout_request_id || transaction?.checkoutRequestId || "").toString().trim();
  const gatewayStatus = normalizeGatewayStatusFromXecoflow(
    transaction?.status,
    transaction?.result_code
  );
  const resultCode = transaction?.result_code ?? null;
  const resultDesc = transaction?.result_description || "";
  const amount = toNumberOrNull(transaction?.amount);
  const phoneNumber = (transaction?.phone_number || "").toString().trim();
  const updates = {
    "payment.transactionId": receiptCode || current?.payment?.transactionId || "",
    "payment.gatewayStatus": gatewayStatus,
    "payment.resultCode": resultCode,
    "payment.resultDesc": resultDesc,
    "payment.updatedAt": FieldValue.serverTimestamp()
  };

  if (checkoutRequestId) {
    updates["payment.checkoutRequestId"] = checkoutRequestId;
  }
  if (amount !== null) {
    updates["payment.amount"] = amount;
  }
  if (phoneNumber) {
    updates["payment.phoneNumber"] = phoneNumber;
  }

  const currentStatus = normalizeStatus(current?.status);
  const isSuccess = gatewayStatus === "success" || resultCode === 0 || resultCode === "0";
  const isFailure = gatewayStatus === "failed" || gatewayStatus === "cancelled";
  const isCancelled = gatewayStatus === "cancelled" || isCancelledTransaction(transaction);

  if (isSuccess) {
    if (!isPaidStatus(currentStatus)) {
      updates.status = "paid";
      updates.paidAt = FieldValue.serverTimestamp();
    }
  } else if (isFailure) {
    if (!isFailedStatus(currentStatus)) {
      updates.status = isCancelled ? "cancelled" : "failed";
      updates.failureReason = getFailureReason(transaction);
    }
  }

  await orderRef.update(updates);
  const updatedSnap = await orderRef.get();
  return { id: updatedSnap.id, data: updatedSnap.data() || {} };
};

const loadTransactionByReceipt = async (receipt) => {
  const missing = getMissingXecoflowConfig({ requireGateway: true });
  if (missing.length) {
    throw new XecoflowRequestError(
      500,
      `Payment lookup is not configured. Missing: ${missing.join(", ")}`
    );
  }

  const endpoint = buildXecoflowByReceiptUrl(receipt);
  if (!endpoint) {
    throw new XecoflowRequestError(
      500,
      "Receipt lookup endpoint is not configured."
    );
  }

  return requestXecoflowJson(endpoint, {
    method: "GET",
    headers: {
      "Content-Type": "application/json"
    }
  });
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).setHeader("Allow", "POST").json({ error: "Method Not Allowed" });
    return;
  }

  const decoded = await requireUser(req, res);
  if (!decoded) return;

  const body = parseBody(req);
  const code = normalizeTransactionCode(body.code || body.receipt);
  if (!code) {
    res.status(400).json({ error: "Transaction code is required." });
    return;
  }

  try {
    const db = getAdminDb();

    const local = await getMatchedLocalOrder(db, code, decoded);
    if (local.matched) {
      if (isOrderExpired(local.matched.data)) {
        res.status(403).json({ error: "Payment receipt is expired or invalid (older than 24 hours)." });
        return;
      }
      res.status(200).json({ order: sanitizeOrderForClient(local.matched.id, local.matched.data) });
      return;
    }

    if (local.hasForeignOwned && !local.pendingUnassigned) {
      res.status(403).json({
        error: "No payment linked to your account was found for that transaction code."
      });
      return;
    }

    const upstreamResponse = await loadTransactionByReceipt(code);
    const transaction = pickTransactionPayload(upstreamResponse);
    if (!transaction || typeof transaction !== "object") {
      res.status(502).json({
        error: "Unable to parse payment response."
      });
      return;
    }

    const checkoutRequestId =
      (transaction.checkout_request_id || transaction.checkoutRequestId || "").toString().trim();

    let targetOrder =
      (checkoutRequestId && (await findOrderByCheckoutRequestId(db, checkoutRequestId))) ||
      local.pendingUnassigned;

    if (!targetOrder) {
      res.status(404).json({
        error: "Payment found, but no local order matches this receipt."
      });
      return;
    }

    targetOrder = await updateOrderFromTransaction(db, targetOrder, transaction, code);

    if (isOrderExpired(targetOrder.data)) {
      res.status(403).json({ error: "Payment receipt is expired or invalid (older than 24 hours)." });
      return;
    }

    if (!isOwner(targetOrder.data, decoded)) {
      if (hasOwner(targetOrder.data)) {
        res.status(403).json({
          error: "No payment linked to your account was found for that transaction code."
        });
        return;
      }

      if (!isPaymentConfirmed(targetOrder.data)) {
        res.status(409).json({
          error: "Order found but payment is not confirmed yet."
        });
        return;
      }

      targetOrder = await claimOrder(db, targetOrder.id, decoded);
    }

    res.status(200).json({
      order: sanitizeOrderForClient(targetOrder.id, targetOrder.data),
      transaction: {
        receipt: normalizeTransactionCode(
          transaction.mpesa_receipt || transaction.transaction_id || code
        ),
        checkoutRequestId:
          (transaction.checkout_request_id || transaction.checkoutRequestId || "").toString().trim(),
        status: (transaction.status || "").toString(),
        resultCode: transaction.result_code ?? null,
        resultDescription: (transaction.result_description || "").toString(),
        failureReason: (transaction.failure_reason || "").toString(),
        amount: toNumberOrNull(transaction.amount),
        phoneNumber: (transaction.phone_number || "").toString()
      }
    });
  } catch (err) {
    if (err instanceof XecoflowRequestError) {
      if (err.status === 404) {
        res.status(404).json({
          error: err.message || "Transaction not found for this receipt number."
        });
        return;
      }
      if (err.status === 400) {
        res.status(400).json({
          error: err.message || "Receipt number is required."
        });
        return;
      }
      if (err.status === 401) {
        res.status(502).json({
          error: "Payment provider authentication failed. Refresh server credentials."
        });
        return;
      }
      res.status(err.status || 502).json({
        error: err.message || "Unable to verify transaction code."
      });
      return;
    }

    console.error("[orders/by-transaction] failed", err);
    res.status(500).json({ error: "Unable to verify transaction code." });
  }
}
