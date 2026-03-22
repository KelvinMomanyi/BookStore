import { io } from "socket.io-client";

const BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").trim();
const GATEWAY_URL = (
  import.meta.env.VITE_XECO_GATEWAY_URL ||
  (BASE_URL ? `${BASE_URL}/api/v1/gateway` : "")
).trim();
const API_KEY = (import.meta.env.VITE_XECO_API_KEY || "").trim();
const SHORTCODE = (import.meta.env.VITE_XECO_BUSINESS_SHORTCODE || "").trim();
const SOCKET_NAMESPACE = (import.meta.env.VITE_XECO_SOCKET_NAMESPACE || "/business").trim();
const CALLBACK_URL = (import.meta.env.VITE_XECO_CALLBACK_URL || "").trim();
const STK_PROXY_URL = (
  import.meta.env.VITE_STK_PROXY_URL ||
  (import.meta.env.PROD ? "/api/stkpush" : "")
).trim();
const USE_STK_PROXY = Boolean(STK_PROXY_URL);

const MIN_STK_AMOUNT = 5;
const MAX_ACCOUNT_REFERENCE_LENGTH = 12;
const SOCKET_URL = (
  import.meta.env.VITE_XECO_SOCKET_URL ||
  (BASE_URL
    ? `${BASE_URL.replace(/\/+$/, "")}/${SOCKET_NAMESPACE.replace(/^\/+/, "")}`
    : "")
).trim();

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

  if (USE_STK_PROXY) {
    if (!STK_PROXY_URL) {
      missing.push("VITE_STK_PROXY_URL");
    }
  } else {
    if (!API_KEY) {
      missing.push("VITE_XECO_API_KEY");
    }
    if (!GATEWAY_URL) {
      missing.push("VITE_XECO_GATEWAY_URL (or VITE_API_BASE_URL)");
    }
    if (!SHORTCODE) {
      missing.push("VITE_XECO_BUSINESS_SHORTCODE");
    }
    if (!CALLBACK_URL) {
      missing.push("VITE_XECO_CALLBACK_URL");
    }
  }

  return missing;
};

const getMissingSocketConfig = () => {
  const missing = [];

  if (!API_KEY) {
    missing.push("VITE_XECO_API_KEY");
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

console.log("Payment Config Checked:", {
  usingStkProxy: USE_STK_PROXY,
  stkProxyUrl: STK_PROXY_URL,
  hasApiKey: !!API_KEY,
  shortcode: SHORTCODE,
  baseUrl: BASE_URL,
  gatewayUrl: GATEWAY_URL,
  socketUrl: SOCKET_URL
});

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
    businessShortcode: data.businessShortcode || SHORTCODE || undefined,
    callbackUrl: data.callbackUrl || CALLBACK_URL || undefined,
    description: data.description || "Book Store Purchase",
    accountReference: (data.accountReference || data.userId || "Order")
      .toString()
      .trim()
      .slice(0, MAX_ACCOUNT_REFERENCE_LENGTH),
    socketId: data.socketId,
    socket_id: data.socketId
  };

  console.log("Initiating STK Push with payload:", payload);

  const requestUrl = USE_STK_PROXY ? STK_PROXY_URL : `${GATEWAY_URL}/stkpush`;
  const headers = {
    "Content-Type": "application/json",
  };

  if (!USE_STK_PROXY && API_KEY) {
    headers["X-API-Key"] = API_KEY;
  }

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

  console.log("Setting up socket to:", SOCKET_URL);
  const socket = io(SOCKET_URL, {
    auth: API_KEY ? { apiKey: API_KEY } : undefined,
    transports: ["websocket", "polling"],
    reconnection: true,
    reconnectionAttempts: 5,
    timeout: 10000
  });

  return socket;
};
