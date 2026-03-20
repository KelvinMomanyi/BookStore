export const normalizeStatus = (value) =>
  (value || "").toString().trim().toLowerCase();

export const isPaidStatus = (value) => {
  const status = normalizeStatus(value);
  return (
    status === "paid" ||
    status === "success" ||
    status === "completed" ||
    status === "confirmed" ||
    status === "payment_success" ||
    status === "payment-confirmed"
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
    status === "payment_failed" ||
    status === "payment_cancelled" ||
    status === "payment_canceled"
  );
};
