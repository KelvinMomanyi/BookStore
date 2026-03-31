export const normalizeStatus = (value) =>
  (value || "").toString().trim().toLowerCase();

export const isPaidStatus = (value) => {
  const status = normalizeStatus(value);
  return (
    status === "paid" ||
    status === "success" ||
    status === "completed" ||
    status === "confirmed" ||
    status === "payment.success" ||
    status === "payment_success" ||
    status === "payment-confirmed" ||
    status === "payment_confirmed"
  );
};

export const isFailedStatus = (value) => {
  const status = normalizeStatus(value);
  return (
    status === "failed" ||
    status === "cancelled" ||
    status === "canceled" ||
    status === "timeout" ||
    status === "expired" ||
    status === "payment.failed" ||
    status === "payment_failed" ||
    status === "payment.cancelled" ||
    status === "payment.canceled" ||
    status === "payment_cancelled" ||
    status === "payment_canceled"
  );
};
