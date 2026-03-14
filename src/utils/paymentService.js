import { io } from "socket.io-client";

const BASE_URL = import.meta.env.VITE_API_BASE_URL || "https://xecoflow.onrender.com";
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
    // Surface the specific error from the backend if available
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
  
  socket.on("connect", () => {
  });

  socket.on("connect_error", (error) => {
  });

  return socket;
};
