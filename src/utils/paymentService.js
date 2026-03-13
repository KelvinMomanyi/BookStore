import { io } from "socket.io-client";

const BASE_URL = "https://xecoflow.onrender.com";
const API_URL = `${BASE_URL}/api/v1/payments/stkpush`;

/**
 * Initiates an MPESA STK Push
 * @param {Object} data - { phoneNumber, amount, userId, socketId }
 * @returns {Promise<Object>} - The response from the backend
 */
export const initiateStkPush = async (data) => {
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.message || "Failed to initiate payment");
  }

  return response.json();
};

/**
 * Sets up a socket connection and returns the socket instance
 * @returns {Object} - socket instance
 */
export const setupSocket = () => {
  const socket = io(BASE_URL);
  
  socket.on("connect", () => {
    console.log("Connected to payment socket:", socket.id);
  });

  socket.on("connect_error", (error) => {
    console.error("Socket connection error:", error);
  });

  return socket;
};
