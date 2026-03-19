import { io } from "socket.io-client";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://xecoflow.onrender.com";
const GATEWAY_URL = import.meta.env.VITE_XECO_GATEWAY_URL || `${BASE_URL}/api/v1/gateway`;
const API_KEY = (import.meta.env.VITE_XECO_API_KEY || "").trim();
const MIN_STK_AMOUNT = 10;

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

  if (!API_KEY) {
    missing.push("VITE_XECO_API_KEY");
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
  hasApiKey: !!API_KEY,
  baseUrl: BASE_URL,
  gatewayUrl: GATEWAY_URL
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

  const payload = {
    phone,
    amount
  };

  if (data.accountReference || data.userId) {
    payload.accountReference = data.accountReference || data.userId || "BookStore";
  }

  if (data.socketId) {
    payload.socketId = data.socketId;
  }

  console.log("Initiating STK Push with payload:", payload);

  const response = await fetch(`${GATEWAY_URL}/stkpush`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { "X-API-Key": API_KEY } : {})
    },
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
  console.log("Setting up socket to:", BASE_URL);
  const socket = io(BASE_URL, {
    transports: ["websocket", "polling"]
  });
  
  return socket;
};
