import { auth } from "../firebase.js";

const STK_PROXY_URL = (
  import.meta.env.VITE_STK_PROXY_URL ||
  (import.meta.env.PROD ? "/api/stkpush" : "")
).trim();

const PAYMENT_STATUS_URL = (
  import.meta.env.VITE_PAYMENT_STATUS_URL ||
  (import.meta.env.PROD ? "/api/payments/status" : "")
).trim();

const MIN_STK_AMOUNT = 5;

const resolveRequestUrl = (value) => {
  const raw = (value || "").trim();
  if (!raw) return "";

  try {
    return new URL(raw).toString();
  } catch {
    return new URL(raw, window.location.origin).toString();
  }
};

export const normalizePhoneForGateway = (value) => {
  const digits = (value || "").toString().replace(/\D/g, "");

  if (/^254\d{9}$/.test(digits)) {
    return digits;
  }

  if (/^0\d{9}$/.test(digits)) {
    return `254${digits.slice(1)}`;
  }

  if (/^[17]\d{8}$/.test(digits)) {
    return `254${digits}`;
  }

  return "";
};

const getMissingPaymentConfig = () => {
  const missing = [];

  if (!STK_PROXY_URL) {
    missing.push("VITE_STK_PROXY_URL");
  }

  return missing;
};

const getMissingStatusConfig = () => {
  const missing = [];

  if (!PAYMENT_STATUS_URL) {
    missing.push("VITE_PAYMENT_STATUS_URL");
  }

  return missing;
};

const getErrorMessageFromResponse = async (response) => {
  const fallback = `Payment gateway request failed (${response.status})`;

  try {
    const contentType = response.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      const errorData = await response.json();
      return errorData.error || errorData.message || fallback;
    }

    const text = await response.text();
    return text || fallback;
  } catch {
    return fallback;
  }
};

export const extractCheckoutIdentifiers = (payload) => {
  const root = payload && typeof payload === "object" ? payload : {};
  const data = root.data && typeof root.data === "object" ? root.data : {};

  return {
    checkoutRequestId:
      data.checkoutRequestId ||
      data.checkout_request_id ||
      data.CheckoutRequestID ||
      root.checkoutRequestId ||
      root.checkout_request_id ||
      root.CheckoutRequestID ||
      "",
    merchantRequestId:
      data.merchantRequestId ||
      data.merchant_request_id ||
      data.MerchantRequestID ||
      root.merchantRequestId ||
      root.merchant_request_id ||
      root.MerchantRequestID ||
      ""
  };
};

export const initiateStkPush = async (data) => {
  const missingConfig = getMissingPaymentConfig();
  if (missingConfig.length) {
    throw new Error(
      `Payment setup incomplete. Missing ${missingConfig.join(
        ", "
      )}. Set it in frontend environment variables, then restart/redeploy.`
    );
  }

  const phone = normalizePhoneForGateway(data.phoneNumber);
  if (!phone) {
    throw new Error(
      "Enter a valid M-Pesa number. Use 254XXXXXXXXX, 07XXXXXXXX, or 01XXXXXXXX."
    );
  }

  const amount = Number(data.amount);
  if (!Number.isFinite(amount) || amount < MIN_STK_AMOUNT) {
    throw new Error(`Minimum M-Pesa amount is KES ${MIN_STK_AMOUNT}.`);
  }

  const reference = (
    data.reference ||
    data.accountReference ||
    data.orderId ||
    data.userId ||
    "Order"
  )
    .toString()
    .trim();

  if (!reference) {
    throw new Error("Payment reference is required.");
  }

  const payload = {
    phone,
    amount,
    reference,
    description: data.description || "Book Store Purchase"
  };

  const response = await fetch(resolveRequestUrl(STK_PROXY_URL), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const message = await getErrorMessageFromResponse(response);
    throw new Error(message);
  }

  return response.json();
};

export const checkPaymentStatus = async ({ orderId, checkoutId }) => {
  const missingConfig = getMissingStatusConfig();
  if (missingConfig.length) {
    throw new Error(
      `Payment setup incomplete. Missing ${missingConfig.join(
        ", "
      )}. Set it in frontend environment variables, then restart/redeploy.`
    );
  }

  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("Please sign in first.");
  }

  const token = await currentUser.getIdToken();
  const response = await fetch(resolveRequestUrl(PAYMENT_STATUS_URL), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      orderId,
      checkoutId
    })
  });

  if (!response.ok) {
    const message = await getErrorMessageFromResponse(response);
    throw new Error(message);
  }

  return response.json();
};
