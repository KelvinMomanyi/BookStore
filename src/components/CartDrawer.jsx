import { useMemo, useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc
} from "firebase/firestore";
import { db } from "../firebase.js";
import { useCart } from "../state/CartContext.jsx";
import { formatCurrency } from "../utils/format.js";
import {
  initiateStkPush,
  normalizePhoneForGateway,
  setupSocket
} from "../utils/paymentService.js";
import { isFailedStatus, isPaidStatus, normalizeStatus } from "../utils/orderStatus.js";

const storeOrder = (order) => {
  try {
    const existing = JSON.parse(localStorage.getItem("novaleaf_orders") || "[]");
    const updated = [order, ...existing].slice(0, 5);
    localStorage.setItem("novaleaf_orders", JSON.stringify(updated));
  } catch {
    // ignore
  }
};

const getFileExtension = (url) => {
  const clean = (url || "").split("?")[0].split("#")[0];
  const lastDot = clean.lastIndexOf(".");
  if (lastDot === -1) return "";
  return clean.slice(lastDot + 1).toLowerCase();
};

const buildDownloadUrl = (url, filename) => {
  if (!url) return "";
  if (!url.includes("cloudinary.com")) return url;

  const proxyBase = getProxyBase();
  if (proxyBase) {
    const sourceUrl = stripAttachmentFlag(url);
    return wrapDownloadProxy(sourceUrl, filename);
  }

  const parts = url.split("/upload/");
  if (parts.length < 2) return url;

  const encodedName = filename ? encodeURIComponent(filename) : "";
  const flag = encodedName ? `fl_attachment:${encodedName}` : "fl_attachment";
  const rest = parts.slice(1).join("/upload/");

  if (rest.startsWith("fl_attachment")) {
    const updated = rest.replace(/^fl_attachment[^/]*\//, `${flag}/`);
    return wrapDownloadProxy(`${parts[0]}/upload/${updated}`, filename);
  }

  return wrapDownloadProxy(`${parts[0]}/upload/${flag}/${rest}`, filename);
};

const stripAttachmentFlag = (url) =>
  url.replace(/\/upload\/fl_attachment[^/]*\//, "/upload/");

const getProxyBase = () => {
  if (import.meta.env.VITE_DOWNLOAD_PROXY_URL) {
    return import.meta.env.VITE_DOWNLOAD_PROXY_URL;
  }
  return import.meta.env.PROD ? "/api/download" : "";
};

const wrapDownloadProxy = (directUrl, filename) => {
  const proxyBase = getProxyBase();
  if (!proxyBase) return directUrl;
  try {
    const proxyUrl = new URL(proxyBase, window.location.origin);
    proxyUrl.searchParams.set("url", directUrl);
    if (filename) {
      proxyUrl.searchParams.set("filename", filename);
    }
    return proxyUrl.toString();
  } catch {
    return directUrl;
  }
};

const buildDownloadLabel = (url) => {
  const ext = getFileExtension(url);
  if (ext === "pdf") return "Download PDF";
  if (ext === "epub") return "Download EPUB";
  return "Download ebook";
};

const buildDownloadName = (url, title) => {
  const ext = getFileExtension(url);
  const safeTitle = (title || "ebook").replace(/\s+/g, "_");
  return ext ? `${safeTitle}.${ext}` : safeTitle;
};

export default function CartDrawer() {
  const {
    items,
    isOpen,
    closeCart,
    removeFromCart,
    updateQty,
    clearCart,
    summary
  } = useCart();
  const [phoneNumber, setPhoneNumber] = useState("");
  const [orderId, setOrderId] = useState("");
  const [orderStatus, setOrderStatus] = useState("");
  const [status, setStatus] = useState("");
  const [placing, setPlacing] = useState(false);
  const [purchasedItems, setPurchasedItems] = useState([]);
  const socketRef = useRef(null);
  const timeoutRef = useRef(null);
  const paymentPendingRef = useRef(false);
  const paymentSettledRef = useRef(false);
  const stkRequestSentRef = useRef(false);

  const total = useMemo(() => summary.subtotal, [summary.subtotal]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
      paymentPendingRef.current = false;
      paymentSettledRef.current = false;
      stkRequestSentRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!orderId) return;

    const unsubscribe = onSnapshot(
      doc(db, "orders", orderId),
      (snapshot) => {
        if (!snapshot.exists()) return;
        const data = snapshot.data();

        const normalizedStatus = normalizeStatus(data.status);

        setOrderStatus(normalizedStatus);

        if (Array.isArray(data.items) && data.items.length > 0) {
          setPurchasedItems(data.items);
        }

        if (isPaidStatus(normalizedStatus)) {
          setStatus("Payment confirmed! Your download is ready below.");
          setPlacing(false);
          clearCart();
          if (socketRef.current) {
            socketRef.current.disconnect();
            socketRef.current = null;
          }
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
        } else if (isFailedStatus(normalizedStatus)) {
          const reason =
            data.failureReason || data.payment?.failureReason || "";
          const isCancelled =
            normalizedStatus === "cancelled" ||
            normalizedStatus === "canceled" ||
            normalizedStatus === "payment_cancelled" ||
            normalizedStatus === "payment_canceled";
          setStatus(
            reason
              ? `${isCancelled ? "Payment cancelled" : "Payment failed"}: ${reason}`
              : isCancelled
                ? "Payment was cancelled."
                : "Payment failed. Please try again."
          );
          setPlacing(false);
          if (socketRef.current) {
            socketRef.current.disconnect();
            socketRef.current = null;
          }
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
        }
      },
      () => {
        setStatus("Unable to confirm payment status. Please refresh.");
      }
    );

    return () => unsubscribe();
  }, [orderId, clearCart]);

  const buildOrderItems = (cartItems) =>
    cartItems.map((item) => ({
      bookId: item.id,
      title: item.title,
      author: item.author,
      price: item.price,
      qty: item.qty,
      coverUrl: item.coverUrl || "",
      fileUrl: item.fileUrl || ""
    }));

  const resetOrderState = () => {
    setOrderId("");
    setOrderStatus("");
    setPurchasedItems([]);
    paymentPendingRef.current = false;
    paymentSettledRef.current = false;
    stkRequestSentRef.current = false;
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  };

  const finalizeCheckout = () => {
    paymentPendingRef.current = false;
    paymentSettledRef.current = true;
    stkRequestSentRef.current = false;
    setPlacing(false);
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  };

  const handleCheckout = async () => {
    setStatus("");
    resetOrderState();

    if (!items.length) return;
    const rawPhone = phoneNumber.trim();
    if (!rawPhone) {
      setStatus("Enter your M-Pesa phone number.");
      return;
    }

    if (total < 10) {
      setStatus("Minimum M-Pesa amount is KES 10.");
      return;
    }

    const deliveryPhone = normalizePhoneForGateway(rawPhone);
    if (!deliveryPhone) {
      setStatus("Use a valid M-Pesa number (e.g. 2547XXXXXXXX, 07XXXXXXXX, or 01XXXXXXXX).");
      return;
    }

    paymentPendingRef.current = true;
    paymentSettledRef.current = false;
    stkRequestSentRef.current = false;
    setPlacing(true);

    const orderItems = buildOrderItems(items);

    let docRef;
    try {
      setStatus("Creating your order...");
      docRef = await addDoc(collection(db, "orders"), {
        phoneNumber: deliveryPhone,
        items: orderItems,
        total,
        createdAt: serverTimestamp(),
        status: "pending",
        payment: {
          provider: "mpesa",
          status: "initiated"
        }
      });
    } catch (err) {
      console.error("Order creation failed:", err);
      const reason = err?.message || "Please try again.";
      setStatus(`Unable to create the order: ${reason}`);
      setPlacing(false);
      return;
    }

    setOrderId(docRef.id);
    setOrderStatus("pending");
    setPurchasedItems(orderItems);
    storeOrder({ id: docRef.id });

    const orderDocRef = doc(db, "orders", docRef.id);

    setStatus("Connecting to payment system...");

    try {
      const newSocket = setupSocket();
      socketRef.current = newSocket;

      const settleOnce = () => {
        if (paymentSettledRef.current) return false;
        paymentSettledRef.current = true;
        return true;
      };

      const normalizeGatewayStatus = (value) =>
        (value || "").toString().trim().toLowerCase();

      const extractResultCode = (payload) =>
        payload?.ResultCode ??
        payload?.resultCode ??
        payload?.Body?.stkCallback?.ResultCode ??
        payload?.Body?.stkCallback?.resultCode ??
        null;

      const isGatewaySuccess = (payload) => {
        const statusValue = normalizeGatewayStatus(payload?.status);
        const resultCode = extractResultCode(payload);
        return (
          statusValue === "payment_success" ||
          statusValue === "success" ||
          statusValue === "paid" ||
          resultCode === 0 ||
          resultCode === "0"
        );
      };

      const isGatewayFailure = (payload) => {
        const statusValue = normalizeGatewayStatus(payload?.status);
        const resultCode = extractResultCode(payload);
        return (
          statusValue === "payment_cancelled" ||
          statusValue === "payment_canceled" ||
          statusValue === "payment_failed" ||
          statusValue === "failed" ||
          statusValue === "cancelled" ||
          statusValue === "canceled" ||
          statusValue === "timeout" ||
          statusValue === "error" ||
          (resultCode !== null && resultCode !== undefined && resultCode !== 0 && resultCode !== "0")
        );
      };

      const isGatewayCancellation = (payload, eventName = "") => {
        const statusValue = normalizeGatewayStatus(payload?.status);
        const resultCode = extractResultCode(payload);
        const eventValue = normalizeGatewayStatus(eventName);

        return (
          statusValue === "payment_cancelled" ||
          statusValue === "payment_canceled" ||
          statusValue === "cancelled" ||
          statusValue === "canceled" ||
          eventValue.includes("cancel") ||
          resultCode === 1032 ||
          resultCode === "1032"
        );
      };

      const getGatewayPayload = (value) => {
        const source = Array.isArray(value) ? value[0] : value;
        return source?.data || source?.Body?.stkCallback || source;
      };

      const getFailureMessage = (payload, eventName = "") => {
        const resultCode = extractResultCode(payload);
        const rawMessage =
          payload?.message ||
          payload?.ResultDesc ||
          payload?.resultDesc ||
          payload?.error ||
          "";

        if (resultCode === 1032 || resultCode === "1032") {
          return "Payment was cancelled on phone.";
        }
        if (resultCode === 1037 || resultCode === "1037") {
          return "Payment request timed out on phone.";
        }
        if (rawMessage) {
          return rawMessage;
        }

        if (isGatewayCancellation(payload, eventName)) {
          return "Payment was cancelled.";
        }

        const statusValue = normalizeGatewayStatus(payload?.status);
        if (statusValue) {
          return `Payment ${statusValue.replace(/_/g, " ")}.`;
        }

        return "Payment failed.";
      };

      const handleFailure = async (error, failureStatus = "failed") => {
        if (!settleOnce()) return;
        const msg =
          error?.message ||
          error?.ResultDesc ||
          (failureStatus === "cancelled"
            ? "Payment was cancelled."
            : "Payment failed. Please try again.");
        console.warn("Payment failed", {
          orderId: docRef.id,
          message: msg,
          error
        });
        setStatus(
          failureStatus === "cancelled"
            ? `Payment cancelled: ${msg}`
            : `Payment failed: ${msg}`
        );
        try {
          await updateDoc(orderDocRef, {
            status: failureStatus,
            failureReason: msg,
            "payment.gatewayStatus": failureStatus,
            "payment.updatedAt": serverTimestamp()
          });
        } catch {
          // ignore update failures
        } finally {
          finalizeCheckout();
        }
      };

      const handleSuccess = async (data) => {
        if (!settleOnce()) return;
        const transactionId =
          data?.CheckoutRequestID ||
          data?.MpesaReceiptNumber ||
          data?.mpesa_receipt_number ||
          "";
        console.info("Payment successful", {
          orderId: docRef.id,
          transactionId,
          data
        });
        setStatus("Payment confirmed! Preparing your download links...");
        try {
          await updateDoc(orderDocRef, {
            status: "paid", // Transition to paid immediately
            paidAt: serverTimestamp(),
            "payment.gatewayStatus": "success",
            "payment.transactionId": transactionId,
            "payment.resultCode":
              data?.ResultCode ?? data?.Body?.stkCallback?.ResultCode ?? null,
            "payment.updatedAt": serverTimestamp()
          });
        } catch (err) {
          console.error("Failed to update order status:", err);
          setStatus("Payment received, but we're having trouble updating your order. Please refresh.");
        } finally {
          finalizeCheckout();
        }
      };

      const processGatewayEvent = (eventName, rawData) => {
        console.log(`Socket Received [${eventName}]:`, rawData);
        const payload = getGatewayPayload(rawData);
        const safePayload =
          payload && typeof payload === "object" ? payload : {};

        if (isGatewaySuccess(payload) || isGatewaySuccess(rawData)) {
          handleSuccess(safePayload);
          return;
        }

        if (isGatewayFailure(payload) || isGatewayFailure(rawData)) {
          const cancelled = isGatewayCancellation(payload, eventName);
          handleFailure(
            {
              ...safePayload,
              message: getFailureMessage(payload, eventName)
            },
            cancelled ? "cancelled" : "failed"
          );
          return;
        }
      };

      const onConnect = async () => {
        if (stkRequestSentRef.current) return;
        stkRequestSentRef.current = true;
        const socketId = newSocket.id;
        setStatus("Initiating M-Pesa STK Push...");

        try {
          const response = await initiateStkPush({
            phoneNumber: deliveryPhone,
            amount: total,
            socketId
          });

          await updateDoc(orderDocRef, {
            payment: {
              provider: "mpesa",
              status: "requested",
              socketId,
              checkoutRequestId:
                response?.CheckoutRequestID || response?.checkoutRequestId || "",
              merchantRequestId:
                response?.MerchantRequestID || response?.merchantRequestId || ""
            }
          });

          setStatus("Please check your phone and enter your M-Pesa PIN.");
        } catch (err) {
          setStatus(`Failed to start payment: ${err.message}`);
          try {
            await updateDoc(orderDocRef, {
              status: "failed",
              failureReason: err.message,
              "payment.gatewayStatus": "failed",
              "payment.updatedAt": serverTimestamp()
            });
          } catch {
            // ignore update failures
          }
          finalizeCheckout();
        }
      };

      newSocket.on("connect_error", (err) => {
        console.error("Socket connection error:", err);
        setStatus("Failed to connect to payment server.");
        updateDoc(orderDocRef, {
          status: "failed",
          failureReason: "Payment server connection failed.",
          "payment.gatewayStatus": "failed",
          "payment.updatedAt": serverTimestamp()
        }).catch(() => {});
        finalizeCheckout();
      });

      newSocket.on("connect", () => {
        console.log("Socket connected successfully, ID:", newSocket.id);
        onConnect();
      });

      newSocket.on("disconnect", (reason) => {
        console.log("Socket disconnected:", reason);
      });

      // Wildcard listener to see EVERYTHING the gateway sends
      newSocket.onAny((event, ...args) => {
        console.log(`[SOCKET DEBUG] Global event received: "${event}"`, args);
      });

      // The XECO gateway sends updates through this event
      newSocket.on("payment-update", (data) => {
        processGatewayEvent("payment-update", data);
      });

      const events = [
        "payment_success",
        "PAYMENT_SUCCESS",
        "payment_failed",
        "PAYMENT_FAILED",
        "payment_error",
        "payment_cancelled",
        "PAYMENT_CANCELLED",
        "payment_canceled",
        "PAYMENT_CANCELED",
        "stk_cancel",
        "stk_cancelled",
        "stk_failed",
        "stk_push_callback",
        "stk_push_status",
        "stk_callback",
        "callback"
      ];
      events.forEach((event) => {
        newSocket.on(event, (data) => {
          processGatewayEvent(event, data);
        });
      });

      timeoutRef.current = setTimeout(() => {
        if (
          newSocket.connected &&
          paymentPendingRef.current &&
          !paymentSettledRef.current
        ) {
          handleFailure({ message: "Request timed out. Please try again." });
        }
      }, 90000);

      if (newSocket.connected) {
        onConnect();
      }
    } catch {
      setStatus("Checkout failed. Please check your connection.");
      finalizeCheckout();
    }
  };


  return (
    <div className={`cart-drawer ${isOpen ? "open" : ""}`}>
      <div className="cart-backdrop" onClick={closeCart} />
      <aside className="cart-panel">
        <div className="cart-header">
          <h3>Your cart</h3>
          <button type="button" className="ghost" onClick={closeCart}>
            Close
          </button>
        </div>
        <div className="cart-body">
          {items.length === 0 ? (
            <p className="empty">Your cart is empty. Add your first ebook.</p>
          ) : (
            items.map((item) => (
              <div key={item.id} className="cart-item">
                <img
                  src={item.coverUrl || "/placeholder-cover.svg"}
                  alt={item.title}
                />
                <div>
                  <h4>{item.title}</h4>
                  <p className="muted">{item.author}</p>
                  <div className="cart-row">
                    <div className="qty">
                      <button
                        type="button"
                        onClick={() => updateQty(item.id, item.qty - 1)}
                      >
                        -
                      </button>
                      <span>{item.qty}</span>
                      <button
                        type="button"
                        onClick={() => updateQty(item.id, item.qty + 1)}
                      >
                        +
                      </button>
                    </div>
                    <span className="price">
                      {formatCurrency(item.price * item.qty)}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="ghost danger"
                    onClick={() => removeFromCart(item.id)}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        <div className="cart-footer">
          <div className="cart-total">
            <span>Subtotal</span>
            <strong>{formatCurrency(total)}</strong>
          </div>
          <div className="checkout-fields">
            <div className="checkout-phone">
              <label>M-Pesa number</label>
              <input
                type="tel"
                value={phoneNumber}
                onChange={(event) => setPhoneNumber(event.target.value)}
                placeholder="2547XXXXXXXX"
                disabled={placing}
              />
            </div>
          </div>
          <button
            type="button"
            className="primary"
            onClick={handleCheckout}
            disabled={!items.length || placing}
          >
            {placing ? "Processing..." : "Pay with M-Pesa"}
          </button>
          
          {placing && orderId && (
            <button
              type="button"
              className="ghost"
              style={{ marginTop: "0.5rem", width: "100%" }}
              onClick={async () => {
                setStatus("Checking payment status...");
                try {
                  const snap = await getDoc(doc(db, "orders", orderId));
                  if (snap.exists()) {
                    const data = snap.data();
                    const normalizedStatus = normalizeStatus(data.status);
                    if (isPaidStatus(normalizedStatus) || isFailedStatus(normalizedStatus)) {
                      setOrderStatus(normalizedStatus);
                      // This will trigger the useEffect for onSnapshot logic if it didn't fire
                    } else {
                      setStatus("Still waiting for M-Pesa... Please check your phone.");
                    }
                  }
                } catch (err) {
                  console.error("Manual check failed:", err);
                }
              }}
            >
              Refresh Status
            </button>
          )}

          {status && (
            <p
              className={`status ${/failed|cancelled|canceled/i.test(status) ? "error" : ""}`}
            >
              {status}
            </p>
          )}
          {orderId && (
            <div className="order-success">
              <div className="order-hint">
                <p>
                  Order ID: <strong>{orderId}</strong>
                </p>
                <p className="muted">
                  Payment status:{" "}
                  {orderStatus ? orderStatus.replace(/_/g, " ") : "pending"}
                </p>
                <Link to="/library" className="ghost" onClick={closeCart}>
                  Go to library
                </Link>
              </div>
              {isPaidStatus(orderStatus) ? (
                <div className="purchased-list">
                  {purchasedItems.map((item) => (
                    <div
                      key={item.bookId || item.id || item.title}
                      className="purchased-item"
                    >
                      <span>{item.title}</span>
                      {item.fileUrl ? (
                        <a
                          href={buildDownloadUrl(
                            item.fileUrl,
                            buildDownloadName(item.fileUrl, item.title)
                          )}
                          download={buildDownloadName(item.fileUrl, item.title)}
                          target="_blank"
                          rel="noreferrer"
                          className="download-btn"
                        >
                          {buildDownloadLabel(item.fileUrl)}
                        </a>
                      ) : (
                        <span className="muted">Processing file...</span>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">
                  Waiting for payment confirmation. Your download button will
                  appear here once payment is confirmed.
                </p>
              )}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

