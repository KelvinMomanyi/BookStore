import { useMemo, useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc
} from "firebase/firestore";
import { db } from "../firebase.js";
import { useCart } from "../state/CartContext.jsx";
import { formatCurrency } from "../utils/format.js";
import { initiateStkPush, setupSocket } from "../utils/paymentService.js";
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

const wrapDownloadProxy = (directUrl, filename) => {
  const proxyBase = import.meta.env.VITE_DOWNLOAD_PROXY_URL;
  if (!proxyBase) return directUrl;
  const base = proxyBase.replace(/\/$/, "");
  const params = new URLSearchParams({ url: directUrl });
  if (filename) {
    params.set("filename", filename);
  }
  return `${base}?${params.toString()}`;
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

  const total = useMemo(() => summary.subtotal, [summary.subtotal]);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
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
          setStatus(
            reason
              ? `Payment failed: ${reason}`
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
    if (!phoneNumber.trim()) {
      setStatus("Enter your M-Pesa phone number.");
      return;
    }

    setPlacing(true);

    const orderItems = buildOrderItems(items);
    const deliveryPhone = phoneNumber.trim();

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

      const handleFailure = async (error) => {
        const msg = error?.message || error?.ResultDesc || "Payment cancelled or timed out.";
        setStatus(`Payment failed: ${msg}`);
        setPlacing(false);
        try {
          await updateDoc(orderDocRef, {
            status: "failed",
            failureReason: msg,
            "payment.gatewayStatus": "failed",
            "payment.updatedAt": serverTimestamp()
          });
        } catch {
          // ignore update failures
        }
        finalizeCheckout();
      };

      const handleSuccess = async (data) => {
        const transactionId =
          data?.CheckoutRequestID ||
          data?.MpesaReceiptNumber ||
          data?.mpesa_receipt_number ||
          "";
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
          setPlacing(false);
          finalizeCheckout();
        } catch (err) {
          console.error("Failed to update order status:", err);
          setStatus("Payment received, but we're having trouble updating your order. Please refresh.");
        }
      };

      const onConnect = async () => {
        const socketId = newSocket.id;
        setStatus("Initiating M-Pesa STK Push...");

        try {
          const response = await initiateStkPush({
            phoneNumber: deliveryPhone,
            amount: total,
            userId: deliveryPhone,
            socketId,
            accountReference: docRef.id,
            description: `Order ${docRef.id}`
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

      // The XECO gateway sends updates through this event
      newSocket.on("payment-update", (data) => {
        const update = Array.isArray(data) ? data[0] : data;
        if (
          update?.status === "PAYMENT_SUCCESS" ||
          update?.ResultCode === 0 ||
          update?.Body?.stkCallback?.ResultCode === 0
        ) {
          handleSuccess(update.data || update.Body?.stkCallback || update);
        } else if (
          update?.status === "PAYMENT_CANCELLED" ||
          update?.status === "PAYMENT_FAILED"
        ) {
          handleFailure({
            message: update.message || update.ResultDesc || `Payment ${update.status.toLowerCase()}`
          });
        }
      });

      newSocket.on("payment_success", handleSuccess);
      newSocket.on("payment_failed", handleFailure);
      newSocket.on("payment_error", handleFailure);
      newSocket.on("payment_cancelled", handleFailure);
      newSocket.on("stk_cancel", handleFailure);
      newSocket.on("stk_failed", handleFailure);

      timeoutRef.current = setTimeout(() => {
        if (newSocket.connected && placing) {
          handleFailure({ message: "Request timed out. Please try again." });
        }
      }, 90000);

      if (newSocket.connected) {
        onConnect();
      } else {
        newSocket.on("connect", onConnect);
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
          {status && <p className={`status ${status.includes("failed") ? "error" : ""}`}>{status}</p>}
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

