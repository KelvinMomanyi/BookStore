import { normalizeEmail } from "./auth.js";

const normalize = (value) => (value || "").toString().trim().toLowerCase();

export const normalizeStatus = (value) => normalize(value);

export const isPaidStatus = (value) => {
  const status = normalizeStatus(value);
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

export const isFailedStatus = (value) => {
  const status = normalizeStatus(value);
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

export const isPaymentConfirmed = (order) => {
  const normalizedOrderStatus = normalizeStatus(order?.status);
  const normalizedGatewayStatus = normalizeStatus(order?.payment?.gatewayStatus);
  const resultCode = order?.payment?.resultCode;

  return (
    isPaidStatus(normalizedOrderStatus) ||
    normalizedGatewayStatus === "success" ||
    resultCode === 0 ||
    resultCode === "0"
  );
};

export const hasOwner = (order) => {
  const uid = (order?.userId || "").toString().trim();
  const email = normalizeEmail(order?.userEmail || "");
  return Boolean(uid || email);
};

export const isOwner = (order, decodedToken) => {
  if (!order || !decodedToken) return false;
  const orderUid = (order.userId || "").toString().trim();
  const tokenUid = (decodedToken.uid || "").toString().trim();
  if (orderUid && tokenUid) return orderUid === tokenUid;

  const orderEmail = normalizeEmail(order.userEmail || "");
  const tokenEmail = normalizeEmail(decodedToken.email || "");
  return Boolean(orderEmail && tokenEmail && orderEmail === tokenEmail);
};

const toEpochMillis = (value) => {
  if (!value) return null;
  if (typeof value?.toMillis === "function") {
    return value.toMillis();
  }
  if (typeof value?.seconds === "number") {
    return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000);
  }
  if (typeof value?._seconds === "number") {
    return value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1000000);
  }
  return null;
};

const toNullableNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

export const sanitizeOrderForClient = (id, order) => {
  const createdAtMs = toEpochMillis(order?.createdAt);
  const linkedAtMs = toEpochMillis(order?.linkedAt);
  const paidAtMs = toEpochMillis(order?.paidAt);
  const paymentUpdatedMs = toEpochMillis(order?.payment?.updatedAt);

  return {
    id,
    userId: (order?.userId || "").toString(),
    userEmail: normalizeEmail(order?.userEmail || ""),
    phoneNumber: (order?.phoneNumber || "").toString(),
    items: Array.isArray(order?.items) ? order.items : [],
    total: Number(order?.total || 0),
    status: order?.status || "pending",
    failureReason: order?.failureReason || "",
    createdAtMs,
    linkedAtMs,
    paidAtMs,
    payment: {
      provider: order?.payment?.provider || "",
      status: order?.payment?.status || "",
      gatewayStatus: order?.payment?.gatewayStatus || "",
      transactionId: order?.payment?.transactionId || "",
      resultCode: order?.payment?.resultCode ?? null,
      resultDesc: order?.payment?.resultDesc || "",
      checkoutRequestId: order?.payment?.checkoutRequestId || "",
      merchantRequestId: order?.payment?.merchantRequestId || "",
      phoneNumber: (order?.payment?.phoneNumber || "").toString(),
      amount: toNullableNumber(order?.payment?.amount),
      amountMismatch: Boolean(order?.payment?.amountMismatch),
      amountExpected: toNullableNumber(order?.payment?.amountExpected),
      updatedAtMs: paymentUpdatedMs
    }
  };
};

export const isOrderExpired = (order) => {
  if (!order) return true;
  const time = toEpochMillis(order.paidAt) || toEpochMillis(order.createdAt) || 0;
  if (!time) return false;
  return (Date.now() - time) > 24 * 60 * 60 * 1000;
};

export const normalizeTransactionCode = (value) =>
  (value || "").toString().trim().toUpperCase();
