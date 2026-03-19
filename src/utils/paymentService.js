import { io } from "socket.io-client";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://xecoflow.onrender.com";
const GATEWAY_URL = import.meta.env.VITE_XECO_GATEWAY_URL || `${BASE_URL}/api/v1/gateway`;
const API_KEY = import.meta.env.VITE_XECO_API_KEY;
const SHORTCODE = import.meta.env.VITE_XECO_BUSINESS_SHORTCODE;
const CALLBACK_URL =
  import.meta.env.VITE_XECO_CALLBACK_URL ||
  "https://webhook.site/d9700924-7eaa-4842-ac57-b9398ac0c54a";

/**
 * Initiates an MPESA STK Push via XECO Gateway
 * @param {Object} data - { phoneNumber, amount, userId, socketId, accountReference, description, callbackUrl }
 * @returns {Promise<Object>} - The response from the gateway
 */
export const initiateStkPush = async (data) => {
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

  const response = await fetch(`${GATEWAY_URL}/stkpush`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": API_KEY,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || errorData.message || "Failed to initiate payment");
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
