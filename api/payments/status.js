import { FieldValue, getAdminDb } from "../_lib/firebaseAdmin.js";
import { parseBody, requireUser } from "../_lib/auth.js";
import {
  isFailedStatus,
  isOwner,
  isPaidStatus,
  normalizeStatus,
  sanitizeOrderForClient
} from "../_lib/orders.js";
import {
  XecoflowRequestError,
  buildXecoflowStatusUrl,
  getMissingXecoflowConfig,
  requestXecoflowJson
} from "../_lib/xecoflow.js";

const normalize = (value) => (value || "").toString().trim();
const normalizeLower = (value) => normalize(value).toLowerCase();

const toNumberOrNull = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const readInput = (req) => {
  if (req.method === "GET") {
    return req.query || {};
  }
  return parseBody(req);
};

const normalizeGatewayStatus = (status, resultCode) => {
  const normalized = normalizeLower(status).replace(/[\s-]+/g, "_");

  if (
    resultCode === 0 ||
    resultCode === "0" ||
    [
      "success",
      "paid",
      "completed",
      "confirmed",
      "payment_success",
      "payment.success",
      "payment_confirmed"
    ].includes(normalized)
  ) {
    return "success";
  }

  if (
    [
      "failed",
      "error",
      "timeout",
      "expired",
      "payment_failed",
      "payment.failed"
    ].includes(normalized)
  ) {
    return "failed";
  }

  if (normalized.includes("cancel")) {
    return "cancelled";
  }

  if (
    [
      "pending",
      "queued",
      "requested",
      "initiated",
      "processing",
      "in_progress",
      "pending_payment",
      "awaiting_customer_action"
    ].includes(normalized)
  ) {
    return "pending";
  }

  return normalized || "pending";
};

const isCancelledGatewayResult = (status, resultCode, resultDesc) => {
  const normalizedStatus = normalizeGatewayStatus(status, resultCode);
  const normalizedDesc = normalizeLower(resultDesc);

  return (
    resultCode === 1032 ||
    resultCode === "1032" ||
    normalizedStatus === "cancelled" ||
    normalizedDesc.includes("cancel")
  );
};

const isSuccessfulGatewayResult = (status, resultCode) =>
  normalizeGatewayStatus(status, resultCode) === "success";

const isFailedGatewayResult = (status, resultCode, resultDesc) => {
  if (isCancelledGatewayResult(status, resultCode, resultDesc)) {
    return true;
  }

  const normalizedStatus = normalizeGatewayStatus(status, resultCode);
  if (normalizedStatus === "failed") {
    return true;
  }

  return (
    resultCode !== null &&
    resultCode !== undefined &&
    resultCode !== 0 &&
    resultCode !== "0"
  );
};

const pickStatusPayload = (response, checkoutId) => {
  const root = response && typeof response === "object" ? response : {};
  const data = root.data && typeof root.data === "object" ? root.data : {};

  return {
    raw: root,
    status:
      root.status ??
      data.status ??
      data.paymentStatus ??
      data.payment_status ??
      "",
    resultCode:
      data.resultCode ??
      data.result_code ??
      root.resultCode ??
      root.result_code ??
      null,
    resultDesc:
      data.resultDesc ??
      data.result_description ??
      root.resultDesc ??
      root.result_description ??
      data.failure_reason ??
      root.failure_reason ??
      "",
    checkoutRequestId:
      normalize(
        data.checkoutRequestId ||
          data.checkout_request_id ||
          root.checkoutRequestId ||
          root.checkout_request_id ||
          checkoutId
      ) || checkoutId,
    merchantRequestId: normalize(
      data.merchantRequestId ||
        data.merchant_request_id ||
        root.merchantRequestId ||
        root.merchant_request_id
    ),
    transactionId: normalize(
      data.transactionId ||
        data.transaction_id ||
        data.mpesa_receipt ||
        data.mpesaReceiptNumber ||
        data.MpesaReceiptNumber ||
        root.transactionId ||
        root.transaction_id ||
        root.mpesa_receipt ||
        root.mpesaReceiptNumber ||
        root.MpesaReceiptNumber
    ),
    amount: toNumberOrNull(data.amount ?? root.amount),
    phoneNumber: normalize(
      data.phoneNumber ||
        data.phone_number ||
        data.phone ||
        root.phoneNumber ||
        root.phone_number ||
        root.phone
    )
  };
};

const getFailureReason = (statusInfo) => {
  if (statusInfo.resultCode === 1032 || statusInfo.resultCode === "1032") {
    return "Payment was cancelled on phone.";
  }

  if (statusInfo.resultCode === 1037 || statusInfo.resultCode === "1037") {
    return "Payment request timed out on phone.";
  }

  if (normalize(statusInfo.resultDesc)) {
    return statusInfo.resultDesc;
  }

  return isCancelledGatewayResult(
    statusInfo.status,
    statusInfo.resultCode,
    statusInfo.resultDesc
  )
    ? "Payment was cancelled."
    : "Payment failed.";
};

const sendGatewayError = (res, err) => {
  if (!(err instanceof XecoflowRequestError)) {
    res.status(500).json({ error: "Unable to fetch payment status." });
    return;
  }

  if (err.status === 404) {
    res.status(200).json({
      success: true,
      paymentStatus: "pending",
      upstreamStatus: "not_found"
    });
    return;
  }

  if (err.data && typeof err.data === "object") {
    res.status(err.status || 502).json(err.data);
    return;
  }

  res.status(err.status || 502).json({
    error: err.message || "Unable to fetch payment status."
  });
};

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res
      .status(405)
      .setHeader("Allow", "GET, POST")
      .json({ error: "Method Not Allowed" });
    return;
  }

  const decoded = await requireUser(req, res);
  if (!decoded) return;

  const input = readInput(req);
  const orderId = normalize(input.orderId);
  const requestedCheckoutId = normalize(
    input.checkoutId || input.checkoutRequestId
  );

  if (!orderId) {
    res.status(400).json({
      error: "Order ID is required."
    });
    return;
  }

  try {
    const db = getAdminDb();
    const orderRef = db.collection("orders").doc(orderId);
    const orderSnap = await orderRef.get();

    if (!orderSnap.exists) {
      res.status(404).json({ error: "Order not found." });
      return;
    }

    const current = orderSnap.data() || {};
    if (!isOwner(current, decoded)) {
      res.status(403).json({
        error: "This order belongs to a different account."
      });
      return;
    }

    const currentStatus = normalizeStatus(current.status);
    if (isPaidStatus(currentStatus) || isFailedStatus(currentStatus)) {
      res.status(200).json({
        success: true,
        paymentStatus: currentStatus,
        order: sanitizeOrderForClient(orderSnap.id, current)
      });
      return;
    }

    const checkoutId =
      requestedCheckoutId ||
      normalize(current?.payment?.checkoutRequestId);

    if (!checkoutId) {
      res.status(400).json({
        error: "Checkout request ID is not available for this order yet."
      });
      return;
    }

    const missing = getMissingXecoflowConfig({ requirePayments: true });
    if (missing.length) {
      res.status(500).json({
        error: `Payment status lookup is not configured. Missing: ${missing.join(", ")}`
      });
      return;
    }

    const endpoint = buildXecoflowStatusUrl(checkoutId);
    if (!endpoint) {
      res.status(500).json({
        error: "Payment status endpoint is not configured."
      });
      return;
    }

    let upstream;
    try {
      upstream = await requestXecoflowJson(endpoint, {
        method: "GET",
        authenticate: false
      });
    } catch (err) {
      if (err instanceof XecoflowRequestError && err.status === 404) {
        res.status(200).json({
          success: true,
          paymentStatus: "pending",
          upstreamStatus: "not_found",
          order: sanitizeOrderForClient(orderSnap.id, current)
        });
        return;
      }

      sendGatewayError(res, err);
      return;
    }

    const statusInfo = pickStatusPayload(upstream, checkoutId);
    const gatewayStatus = normalizeGatewayStatus(
      statusInfo.status,
      statusInfo.resultCode
    );
    const isSuccess = isSuccessfulGatewayResult(
      statusInfo.status,
      statusInfo.resultCode
    );
    const isFailure = isFailedGatewayResult(
      statusInfo.status,
      statusInfo.resultCode,
      statusInfo.resultDesc
    );
    const isCancelled = isCancelledGatewayResult(
      statusInfo.status,
      statusInfo.resultCode,
      statusInfo.resultDesc
    );

    const updates = {
      "payment.status": gatewayStatus,
      "payment.gatewayStatus": gatewayStatus,
      "payment.resultCode": statusInfo.resultCode ?? null,
      "payment.resultDesc": statusInfo.resultDesc || "",
      "payment.checkoutRequestId": statusInfo.checkoutRequestId || checkoutId,
      "payment.updatedAt": FieldValue.serverTimestamp()
    };

    if (statusInfo.merchantRequestId) {
      updates["payment.merchantRequestId"] = statusInfo.merchantRequestId;
    }
    if (statusInfo.transactionId) {
      updates["payment.transactionId"] = statusInfo.transactionId;
    }
    if (statusInfo.phoneNumber) {
      updates["payment.phoneNumber"] = statusInfo.phoneNumber;
    }
    if (statusInfo.amount !== null) {
      updates["payment.amount"] = statusInfo.amount;
    }

    const amountMismatch =
      typeof statusInfo.amount === "number" &&
      typeof current.total === "number" &&
      Math.abs(statusInfo.amount - current.total) > 0.01;

    if (amountMismatch) {
      updates["payment.amountMismatch"] = true;
      updates["payment.amountExpected"] = current.total;
      updates.status = "review";
    } else if (isSuccess) {
      updates.status = "paid";
      updates.paidAt = FieldValue.serverTimestamp();
    } else if (isFailure) {
      updates.status = isCancelled ? "cancelled" : "failed";
      updates.failureReason = getFailureReason(statusInfo);
    }

    await orderRef.update(updates);
    const updatedSnap = await orderRef.get();
    const updatedOrder = updatedSnap.data() || {};

    res.status(200).json({
      success: true,
      paymentStatus: normalizeStatus(updatedOrder.status || gatewayStatus),
      order: sanitizeOrderForClient(updatedSnap.id, updatedOrder),
      upstream
    });
  } catch (err) {
    console.error("[payments/status] failed", err);
    res.status(500).json({
      error: "Unable to fetch payment status."
    });
  }
}
