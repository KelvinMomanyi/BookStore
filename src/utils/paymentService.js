import { io } from "socket.io-client";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://xecoflow.onrender.com";
const GATEWAY_URL = import.meta.env.VITE_XECO_GATEWAY_URL || `${BASE_URL}/api/v1/gateway`;
const API_KEY = (import.meta.env.VITE_XECO_API_KEY || "").trim();
const SHORTCODE = import.meta.env.VITE_XECO_BUSINESS_SHORTCODE || "9203342";
const CALLBACK_URL =
  import.meta.env.VITE_XECO_CALLBACK_URL ||
  "https://webhook.site/d9700924-7eaa-4842-ac57-b9398ac0c54a";

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
  shortcode: SHORTCODE,
  callbackUrl: CALLBACK_URL,
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

  const payload = {
    phoneNumber: data.phoneNumber,
    amount: data.amount,
    userId: data.userId,
    businessShortcode: SHORTCODE,
    callbackUrl: data.callbackUrl || CALLBACK_URL,
    description: data.description || "Book Store Purchase",
    accountReference: data.accountReference || data.userId || "BookStore",
    socketId: data.socketId
  };

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
