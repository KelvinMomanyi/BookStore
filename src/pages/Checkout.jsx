import { useMemo, useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc
} from "firebase/firestore";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup
} from "firebase/auth";
import { auth, db } from "../firebase.js";
import SectionTitle from "../components/SectionTitle.jsx";
import { useCart } from "../state/CartContext.jsx";
import { formatCurrency } from "../utils/format.js";
import {
  initiateStkPush,
  normalizePhoneForGateway,
  setupSocket
} from "../utils/paymentService.js";
import { isFailedStatus, isPaidStatus, normalizeStatus } from "../utils/orderStatus.js";
import { rememberOrder } from "../utils/account.js";
import { authApiRequest } from "../utils/secureApi.js";

const getFileExtension = (url) => {
  const clean = (url || "").split("?")[0].split("#")[0];
  const lastDot = clean.lastIndexOf(".");
  if (lastDot === -1) return "";
  return clean.slice(lastDot + 1).toLowerCase();
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

const triggerDownload = async (url, filename) => {
  const proxyBase = import.meta.env.VITE_DOWNLOAD_PROXY_URL ||
    (import.meta.env.PROD ? "/api/download" : "");

  // In production, use the server-side proxy which signs the Cloudinary URL
  if (proxyBase) {
    try {
      const proxyUrl = new URL(proxyBase, window.location.origin);
      proxyUrl.searchParams.set("url", url);
      if (filename) proxyUrl.searchParams.set("filename", filename);

      const response = await fetch(proxyUrl.toString());
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(`Proxy ${response.status}: ${errorText}`);
      }
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename || "ebook";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      }, 200);
      return;
    } catch (err) {
      console.error("Proxy download failed:", err);
    }
  }

  // Fallback: try fl_attachment via iframe (works if files are public)
  try {
    const parts = url.split("/upload/");
    if (parts.length >= 2) {
      const rest = parts.slice(1).join("/upload/").replace(/^fl_attachment[^/]*\//, "");
      const attachUrl = `${parts[0]}/upload/fl_attachment/${rest}`;
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      iframe.src = attachUrl;
      document.body.appendChild(iframe);
      setTimeout(() => document.body.removeChild(iframe), 10000);
      return;
    }
  } catch { /* ignore */ }

  // Last resort
  window.open(url, "_blank");
};

export default function Checkout() {
  const {
    items,
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
  const [user, setUser] = useState(() => auth.currentUser || null);
  const socketRef = useRef(null);
  const timeoutRef = useRef(null);
  const paymentPendingRef = useRef(false);
  const paymentSettledRef = useRef(false);
  const stkRequestSentRef = useRef(false);

  const total = useMemo(() => summary.subtotal, [summary.subtotal]);
  const checkoutItems = useMemo(
    () => (orderId ? purchasedItems : items),
    [orderId, purchasedItems, items]
  );
  const checkoutTotal = useMemo(
    () => (orderId ? purchasedItems.reduce((sum, item) => sum + item.price * item.qty, 0) : total),
    [orderId, purchasedItems, total]
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser || null);
    });

    return () => {
      unsub();
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

  const handleGoogleLogin = async () => {
    setStatus("");
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
      setStatus("Signed in successfully. You can now complete checkout.");
    } catch (err) {
      console.error("Auth error:", err);
      setStatus(`Google sign-in failed: ${err.code || err.message}`);
    }
  };

  const handleCheckout = async () => {
    setStatus("");
    resetOrderState();
    const currentUser = auth.currentUser || user;

    if (!currentUser) {
      setStatus("Sign in first so this purchase can be linked to your library account.");
      return;
    }

    if (!items.length) return;
    const rawPhone = phoneNumber.trim();
    if (!rawPhone) {
      setStatus("Enter your M-Pesa phone number.");
      return;
    }

    if (total < 5) {
      setStatus("Minimum M-Pesa amount is KES 5.");
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

    let createdOrderId = "";
    try {
      const payload = {
        phoneNumber: deliveryPhone,
        items: orderItems,
        total
      };
      const response = await authApiRequest("/api/orders/create", {
        method: "POST",
        body: payload
      });
      createdOrderId = (response?.id || "").toString().trim();
      if (!createdOrderId) {
        throw new Error("Order ID not returned.");
      }
    } catch (err) {
      console.error("Order creation failed:", err);
      const reason = err?.message || "Please try again.";
      setStatus(`Unable to create the order: ${reason}`);
      setPlacing(false);
      return;
    }

    setOrderId(createdOrderId);
    setOrderStatus("pending");
    setPurchasedItems(orderItems);
    rememberOrder({ id: createdOrderId }, currentUser.uid);

    const orderDocRef = doc(db, "orders", createdOrderId);

    try {
      const newSocket = setupSocket();
      socketRef.current = newSocket;

      const settleOnce = () => {
        if (paymentSettledRef.current) return false;
        paymentSettledRef.current = true;
        return true;
      };

      const normalizeGatewayValue = (value) =>
        (value || "").toString().trim().toLowerCase();

      const extractResultCode = (payload) =>
        payload?.ResultCode ??
        payload?.resultCode ??
        payload?.result_code ??
        payload?.Body?.stkCallback?.ResultCode ??
        payload?.Body?.stkCallback?.resultCode ??
        null;

      const getGatewayEvent = (payload, eventName = "") =>
        normalizeGatewayValue(
          payload?.event ??
          payload?.eventName ??
          payload?.event_name ??
          payload?.type ??
          eventName
        );

      const getGatewayStatus = (payload, eventName = "") =>
        normalizeGatewayValue(
          payload?.status ??
          payload?.gatewayStatus ??
          payload?.paymentStatus ??
          payload?.payment_status ??
          getGatewayEvent(payload, eventName)
        );

      const isGatewaySuccess = (payload, eventName = "") => {
        const statusValue = getGatewayStatus(payload, eventName);
        const eventValue = getGatewayEvent(payload, eventName);
        const resultCode = extractResultCode(payload);
        return (
          statusValue === "payment.success" ||
          statusValue === "payment_success" ||
          statusValue === "success" ||
          statusValue === "paid" ||
          statusValue === "payment_confirmed" ||
          eventValue === "payment.success" ||
          eventValue === "payment_success" ||
          eventValue === "payment_confirmed" ||
          eventValue === "success" ||
          eventValue === "paid" ||
          eventValue === "completed" ||
          resultCode === 0 ||
          resultCode === "0"
        );
      };

      const isGatewayFailure = (payload, eventName = "") => {
        const statusValue = getGatewayStatus(payload, eventName);
        const eventValue = getGatewayEvent(payload, eventName);
        const resultCode = extractResultCode(payload);
        return (
          statusValue === "payment.failed" ||
          statusValue === "payment.canceled" ||
          statusValue === "payment.cancelled" ||
          statusValue === "payment_cancelled" ||
          statusValue === "payment_canceled" ||
          statusValue === "payment_failed" ||
          statusValue === "failed" ||
          statusValue === "cancelled" ||
          statusValue === "canceled" ||
          statusValue === "timeout" ||
          statusValue === "error" ||
          eventValue === "payment.failed" ||
          eventValue === "payment.canceled" ||
          eventValue === "payment.cancelled" ||
          eventValue === "payment_failed" ||
          eventValue === "payment_canceled" ||
          eventValue === "payment_cancelled" ||
          eventValue === "failed" ||
          eventValue === "cancelled" ||
          eventValue === "canceled" ||
          eventValue === "timeout" ||
          eventValue === "error" ||
          (resultCode !== null && resultCode !== undefined && resultCode !== 0 && resultCode !== "0")
        );
      };

      const isGatewayCancellation = (payload, eventName = "") => {
        const statusValue = getGatewayStatus(payload, eventName);
        const resultCode = extractResultCode(payload);
        const eventValue = getGatewayEvent(payload, eventName);

        return (
          statusValue === "payment.cancelled" ||
          statusValue === "payment.canceled" ||
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
        return source?.data || source?.payload || source?.payment || source?.Body?.stkCallback || source;
      };

      const getFailureMessage = (payload, eventName = "") => {
        const resultCode = extractResultCode(payload);
        const rawMessage =
          payload?.message ||
          payload?.failure_reason ||
          payload?.failureReason ||
          payload?.reason ||
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

        const statusValue = getGatewayStatus(payload, eventName);
        if (statusValue) {
          return `Payment ${statusValue.replace(/[_.]/g, " ")}.`;
        }

        return "Payment failed.";
      };

      const handleFailure = async (error, failureStatus = "failed") => {
        if (!settleOnce()) return;
        const msg =
          error?.message ||
          error?.failure_reason ||
          error?.failureReason ||
          error?.ResultDesc ||
          (failureStatus === "cancelled"
            ? "Payment was cancelled."
            : "Payment failed. Please try again.");
        console.warn("Payment failed", {
          orderId: createdOrderId,
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
          data?.transaction_id ||
          data?.transactionId ||
          data?.CheckoutRequestID ||
          data?.MpesaReceiptNumber ||
          data?.mpesa_receipt_number ||
          "";
        console.info("Payment successful", {
          orderId: createdOrderId,
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
            "payment.resultCode": extractResultCode(data),
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
        const payload = getGatewayPayload(rawData);
        const payloadData = payload && typeof payload === "object" ? payload : {};
        const rawDataObject = rawData && typeof rawData === "object" ? rawData : {};
        const mergedPayload = {
          ...rawDataObject,
          ...payloadData,
          event:
            payloadData?.event ||
            rawDataObject?.event ||
            eventName
        };

        if (isGatewaySuccess(mergedPayload, eventName)) {
          handleSuccess(mergedPayload);
          return;
        }

        if (isGatewayFailure(mergedPayload, eventName)) {
          const cancelled = isGatewayCancellation(mergedPayload, eventName);
          handleFailure(
            {
              ...mergedPayload,
              message: getFailureMessage(mergedPayload, eventName)
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

        try {
          const response = await initiateStkPush({
            phoneNumber: deliveryPhone,
            amount: total,
            socketId,
            userId: createdOrderId,
            accountReference: createdOrderId
          });

          await updateDoc(orderDocRef, {
            payment: {
              provider: "mpesa",
              status: "requested",
              socketId: socketId || "",
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
        const message = err?.message || "Failed to connect to payment server.";
        if (!stkRequestSentRef.current) {
          setStatus(
            `${message} Realtime updates are unavailable, but payment request is continuing.`
          );
          onConnect();
          return;
        }
        setStatus("Realtime connection lost. Waiting for payment confirmation...");
      });

      newSocket.on("connect", () => {
        onConnect();
      });

      newSocket.on("connected", () => {
        onConnect();
      });

      // The XECO gateway sends updates through this event
      newSocket.on("payment-update", (data) => {
        processGatewayEvent("payment-update", data);
      });

      const events = [
        "payment_success",
        "payment.success",
        "PAYMENT_SUCCESS",
        "payment_failed",
        "payment.failed",
        "PAYMENT_FAILED",
        "payment_error",
        "payment.error",
        "payment_cancelled",
        "payment.cancelled",
        "PAYMENT_CANCELLED",
        "payment_canceled",
        "payment.canceled",
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
          paymentPendingRef.current &&
          !paymentSettledRef.current
        ) {
          handleFailure({ message: "Request timed out. Please try again." });
        }
      }, 90000);

      onConnect();
    } catch (err) {
      console.error("Socket setup failed. Falling back to direct STK request.", err);
      try {
        const response = await initiateStkPush({
          phoneNumber: deliveryPhone,
          amount: total,
          userId: createdOrderId,
          accountReference: createdOrderId
        });

        await updateDoc(orderDocRef, {
          payment: {
            provider: "mpesa",
            status: "requested",
            socketId: "",
            checkoutRequestId:
              response?.CheckoutRequestID || response?.checkoutRequestId || "",
            merchantRequestId:
              response?.MerchantRequestID || response?.merchantRequestId || ""
          }
        });

        stkRequestSentRef.current = true;
        setStatus("Please check your phone and enter your M-Pesa PIN.");
      } catch (stkErr) {
        const message = stkErr?.message || "Failed to start payment.";
        setStatus(`Failed to start payment: ${message}`);
        try {
          await updateDoc(orderDocRef, {
            status: "failed",
            failureReason: message,
            "payment.gatewayStatus": "failed",
            "payment.updatedAt": serverTimestamp()
          });
        } catch {
          // ignore update failures
        }
        finalizeCheckout();
      }
    }
  };


  return (
    <div className="page">
      <section className="panel">
        <SectionTitle
          title="Checkout"
          subtitle="Complete your M-Pesa payment and unlock instant downloads."
        />

        {!checkoutItems.length && !orderId ? (
          <div className="checkout-empty">
            <p className="empty">Your cart is empty. Add your first ebook.</p>
            <Link to="/store" className="primary">
              Go to store
            </Link>
          </div>
        ) : (
          <div className="checkout-layout">
            <div className="cart-body">
              {checkoutItems.map((item) => (
                <div key={item.bookId || item.id || item.title} className="cart-item">
                  <img
                    src={item.coverUrl || "/placeholder-cover.svg"}
                    alt={item.title}
                  />
                  <div>
                    <h4>{item.title}</h4>
                    <p className="muted">{item.author}</p>
                    <div className="cart-row">
                      {orderId ? (
                        <span className="muted">Qty {item.qty}</span>
                      ) : (
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
                      )}
                      <span className="price">
                        {formatCurrency(item.price * item.qty)}
                      </span>
                    </div>
                    {!orderId ? (
                      <button
                        type="button"
                        className="ghost danger"
                        onClick={() => removeFromCart(item.id)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            <div className="cart-footer">
              <div className="cart-total">
                <span>Subtotal</span>
                <strong>{formatCurrency(checkoutTotal)}</strong>
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
                {!user ? (
                  <>
                    <p className="muted">
                      Sign in with Google to link this order to your library account.
                    </p>
                  </>
                ) : (
                  <p className="muted">
                    This order will be linked to <strong>{user.email}</strong>.
                  </p>
                )}
              </div>

              <button
                type="button"
                className="primary"
                onClick={user ? handleCheckout : handleGoogleLogin}
                disabled={!items.length || placing}
              >
                {placing ? "Processing..." : user ? "Pay with M-Pesa" : "Sign in with Google"}
              </button>

              {placing && orderId ? (
                <button
                  type="button"
                  className="ghost checkout-refresh"
                  onClick={async () => {
                    setStatus("Checking payment status...");
                    try {
                      const snap = await getDoc(doc(db, "orders", orderId));
                      if (snap.exists()) {
                        const data = snap.data();
                        const normalizedStatus = normalizeStatus(data.status);
                        if (isPaidStatus(normalizedStatus) || isFailedStatus(normalizedStatus)) {
                          setOrderStatus(normalizedStatus);
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
              ) : null}

              {status ? (
                <p
                  className={`status ${/failed|cancelled|canceled/i.test(status) ? "error" : ""}`}
                >
                  {status}
                </p>
              ) : null}

              {orderId ? (
                <div className="order-success">
                  <div className="order-hint">
                    <p>
                      Order ID: <strong>{orderId}</strong>
                    </p>
                    <p className="muted">
                      Payment status:{" "}
                      {orderStatus ? orderStatus.replace(/_/g, " ") : "pending"}
                    </p>
                    <Link to="/library" className="ghost">
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
                            <button
                              type="button"
                              className="download-btn"
                              onClick={() =>
                                triggerDownload(
                                  item.fileUrl,
                                  buildDownloadName(item.fileUrl, item.title)
                                )
                              }
                            >
                              {buildDownloadLabel(item.fileUrl)}
                            </button>
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
              ) : null}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
