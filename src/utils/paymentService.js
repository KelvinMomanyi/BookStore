import { io } from "socket.io-client";

const BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").trim();
const SOCKET_AUTH_KEY = (import.meta.env.VITE_XECO_SOCKET_AUTH_KEY || "").trim();
const SERVICE_TYPE = (
  import.meta.env.VITE_XECO_SERVICE_TYPE || "payment"
).trim().toLowerCase();
const SOCKET_NAMESPACE = (import.meta.env.VITE_XECO_SOCKET_NAMESPACE || "/business").trim();
const STK_PROXY_URL = (
  import.meta.env.VITE_STK_PROXY_URL ||
  (import.meta.env.PROD ? "/api/stkpush" : "")
).trim();

const MIN_STK_AMOUNT = 5;
const MAX_ACCOUNT_REFERENCE_LENGTH = 12;
const SOCKET_URL = (
  import.meta.env.VITE_XECO_SOCKET_URL ||
  (BASE_URL
    ? `${BASE_URL.replace(/\/+$/, "")}/${SOCKET_NAMESPACE.replace(/^\/+/, "")}`
    : "")
).trim();

const ensureSocketNamespace = (value) => {
  const raw = (value || "").trim();
  if (!raw) return raw;

  const normalizedNamespace = `/${SOCKET_NAMESPACE.replace(/^\/+/, "")}`;
  if (normalizedNamespace === "/") return raw;

  try {
    const parsed = new URL(raw);
    const path = parsed.pathname.replace(/\/+$/, "");
    if (!path || path === "/") {
      parsed.pathname = normalizedNamespace;
      return parsed.toString().replace(/\/+$/, "");
    }
    return raw;
  } catch {
    return raw;
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

const getMissingSocketConfig = () => {
  const missing = [];

  if (!SOCKET_AUTH_KEY) {
    missing.push("VITE_XECO_SOCKET_AUTH_KEY");
  }
  if (!SOCKET_URL) {
    missing.push("VITE_XECO_SOCKET_URL (or VITE_API_BASE_URL + VITE_XECO_SOCKET_NAMESPACE)");
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

/**
 * Initiates an MPESA STK Push via XECO Gateway
 * @param {Object} data - { phoneNumber, amount, userId, socketId, accountReference, description, callbackUrl }
 * @returns {Promise<Object>} - The response from the gateway
 */
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

  // Restore the complete payload expected by the gateway
  const payload = {
    phoneNumber: phone,
    amount,
    userId: data.userId || phone,
    description: data.description || "Book Store Purchase",
    accountReference: (data.accountReference || data.userId || "Order")
      .toString()
      .trim()
      .slice(0, MAX_ACCOUNT_REFERENCE_LENGTH),
    socketId: data.socketId,
    socket_id: data.socketId
  };

  const requestUrl = STK_PROXY_URL;
  const headers = {
    "Content-Type": "application/json"
  };

  const response = await fetch(requestUrl, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const message = await getErrorMessageFromResponse(response);
    throw new Error(message);
  }

  return response.json();
};

/**
 * Sets up a socket connection and returns the socket instance
 * @returns {Object} - socket instance
 */
export const setupSocket = () => {
  const missingConfig = getMissingSocketConfig();
  if (missingConfig.length) {
    throw new Error(
      `Payment setup incomplete. Missing ${missingConfig.join(
        ", "
      )}. Set it in frontend environment variables, then restart/redeploy.`
    );
  }

  const socketUrl = ensureSocketNamespace(SOCKET_URL);
  const socket = io(socketUrl, {
    auth: SOCKET_AUTH_KEY
      ? { apiKey: SOCKET_AUTH_KEY, serviceType: SERVICE_TYPE || "payment" }
      : undefined,
    query: { serviceType: SERVICE_TYPE || "payment" },
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: 5,
    timeout: 10000
  });

  return socket;
};
