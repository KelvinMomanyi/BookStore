import { useMemo, useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import {
  doc,
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
  checkPaymentStatus,
  extractCheckoutIdentifiers,
  initiateStkPush,
  normalizePhoneForGateway
} from "../utils/paymentService.js";
import { isFailedStatus, isPaidStatus, normalizeStatus } from "../utils/orderStatus.js";
import { rememberOrder } from "../utils/account.js";
import { authApiRequest } from "../utils/secureApi.js";

const getErrorMessage = (err) => (err?.message || "").toString();

const shouldFallbackOrderCreate = (err) => {
  const message = getErrorMessage(err).toLowerCase();
  const looksLikeNetworkIssue =
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("network request failed") ||
    message.includes("load failed") ||
    message.includes("timeout");

  // Fallback writes go through Firestore client rules. Keep this for
  // development-only network outages, not server-side application errors.
  return !import.meta.env.PROD && looksLikeNetworkIssue;
};

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

const buildFailureMessage = (statusValue, reason = "") => {
  const normalizedStatus = normalizeStatus(statusValue);
  const isCancelled =
    normalizedStatus === "cancelled" ||
    normalizedStatus === "canceled" ||
    normalizedStatus === "payment_cancelled" ||
    normalizedStatus === "payment_canceled" ||
    normalizedStatus === "payment.cancelled" ||
    normalizedStatus === "payment.canceled";

  if (reason) {
    return `${isCancelled ? "Payment cancelled" : "Payment failed"}: ${reason}`;
  }

  return isCancelled
    ? "Payment was cancelled."
    : "Payment failed. Please try again.";
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
  const statusPollRef = useRef(null);
  const statusRequestPendingRef = useRef(false);

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
      if (statusPollRef.current) {
        clearInterval(statusPollRef.current);
        statusPollRef.current = null;
      }
      statusRequestPendingRef.current = false;
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
          if (statusPollRef.current) {
            clearInterval(statusPollRef.current);
            statusPollRef.current = null;
          }
        } else if (isFailedStatus(normalizedStatus)) {
          const reason =
            data.failureReason || data.payment?.failureReason || "";
          setStatus(buildFailureMessage(normalizedStatus, reason));
          setPlacing(false);
          if (statusPollRef.current) {
            clearInterval(statusPollRef.current);
            statusPollRef.current = null;
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
    statusRequestPendingRef.current = false;
    if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }
  };

  const finalizeCheckout = () => {
    setPlacing(false);
    statusRequestPendingRef.current = false;
    if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }
  };

  const runStatusCheck = async (targetOrderId, options = {}) => {
    const { silent = false, checkoutId = "" } = options;

    if (!targetOrderId || statusRequestPendingRef.current) {
      return false;
    }

    statusRequestPendingRef.current = true;

    try {
      const response = await checkPaymentStatus({
        orderId: targetOrderId,
        checkoutId
      });
      const nextOrder = response?.order;
      const nextStatus = normalizeStatus(
        nextOrder?.status || response?.paymentStatus || ""
      );

      if (nextStatus) {
        setOrderStatus(nextStatus);
      }

      if (Array.isArray(nextOrder?.items) && nextOrder.items.length > 0) {
        setPurchasedItems(nextOrder.items);
      }

      if (isPaidStatus(nextStatus)) {
        setStatus("Payment confirmed! Your download is ready below.");
        finalizeCheckout();
        return true;
      }

      if (isFailedStatus(nextStatus)) {
        const reason =
          nextOrder?.failureReason ||
          nextOrder?.payment?.resultDesc ||
          response?.message ||
          "";
        setStatus(buildFailureMessage(nextStatus, reason));
        finalizeCheckout();
        return true;
      }

      if (!silent) {
        setStatus("Still waiting for M-Pesa... Please check your phone.");
      }
    } catch (err) {
      console.error("Payment status check failed:", err);
      if (!silent) {
        setStatus(err?.message || "Unable to confirm payment status. Please refresh.");
      }
    } finally {
      statusRequestPendingRef.current = false;
    }

    return false;
  };

  const startStatusPolling = (targetOrderId, checkoutId = "") => {
    if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }

    void runStatusCheck(targetOrderId, { silent: true, checkoutId });

    statusPollRef.current = setInterval(() => {
      void runStatusCheck(targetOrderId, { silent: true, checkoutId });
    }, 6000);
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
      if (shouldFallbackOrderCreate(err)) {
        const reason = err?.message || "Network issue while creating order.";
        setStatus(`Unable to create the order: ${reason}`);
        setPlacing(false);
        return;
      } else {
        console.error("Order creation failed:", err);
        const reason = err?.message || "Please try again.";
        setStatus(`Unable to create the order: ${reason}`);
        setPlacing(false);
        return;
      }
    }

    setOrderId(createdOrderId);
    setOrderStatus("pending");
    setPurchasedItems(orderItems);
    rememberOrder({ id: createdOrderId }, currentUser.uid);

    const orderDocRef = doc(db, "orders", createdOrderId);

    try {
      const response = await initiateStkPush({
        phoneNumber: deliveryPhone,
        amount: total,
        orderId: createdOrderId,
        reference: createdOrderId,
        description: "Book Store Purchase"
      });

      const { checkoutRequestId, merchantRequestId } =
        extractCheckoutIdentifiers(response);

      await updateDoc(orderDocRef, {
        payment: {
          provider: "mpesa",
          status: "requested",
          gatewayStatus: "pending",
          checkoutRequestId: checkoutRequestId || "",
          merchantRequestId: merchantRequestId || "",
          updatedAt: serverTimestamp()
        }
      });

      setStatus("Please check your phone and enter your M-Pesa PIN.");

      if (checkoutRequestId) {
        startStatusPolling(createdOrderId, checkoutRequestId);
      }
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
                    await runStatusCheck(orderId, { silent: false });
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
