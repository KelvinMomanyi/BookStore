import { useEffect, useMemo, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "firebase/auth";
import { auth } from "../firebase.js";
import SectionTitle from "../components/SectionTitle.jsx";
import { formatCurrency } from "../utils/format.js";
import { isFailedStatus, isPaidStatus, normalizeStatus } from "../utils/orderStatus.js";
import { loadStoredOrders, rememberOrder } from "../utils/account.js";
import { authApiRequest } from "../utils/secureApi.js";

const normalizeTransactionCode = (value) =>
  (value || "").toString().trim().toUpperCase();

const isPaymentConfirmed = (order) => {
  const normalizedOrderStatus = normalizeStatus(order?.status);
  const normalizedGatewayStatus = normalizeStatus(order?.payment?.gatewayStatus);
  const resultCode = order?.payment?.resultCode;

  return (
    isPaidStatus(normalizedOrderStatus) ||
    normalizedGatewayStatus === "success" ||
    resultCode === 0 ||
    resultCode === "0"
  );
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

const triggerDownload = async (url, filename) => {
  const proxyBase = import.meta.env.VITE_DOWNLOAD_PROXY_URL ||
    (import.meta.env.PROD ? "/api/download" : "");

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
  } catch {
    // ignore
  }

  window.open(url, "_blank");
};

const getOrderTimestamp = (order) =>
  Number(order?.createdAtMs || order?.linkedAtMs || order?.paidAtMs || 0);

export default function Library() {
  const [user, setUser] = useState(null);
  const [orderId, setOrderId] = useState("");
  const [transactionCode, setTransactionCode] = useState("");
  const [order, setOrder] = useState(null);
  const [accountOrders, setAccountOrders] = useState([]);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetchingPayment, setFetchingPayment] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(false);

  const storedOrders = useMemo(
    () => loadStoredOrders(user?.uid),
    [user?.uid]
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser || null);
      setOrder(null);
      setStatus("");
      if (!currentUser) {
        setOrderId("");
        setTransactionCode("");
        setAccountOrders([]);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user) return;
    if (accountOrders.length > 0) {
      setOrderId((prev) => prev || accountOrders[0].id);
      return;
    }
    if (storedOrders.length > 0) {
      const first = storedOrders[0];
      const firstId = typeof first === "string" ? first : first?.id || "";
      if (firstId) {
        setOrderId((prev) => prev || firstId);
      }
    }
  }, [user, accountOrders, storedOrders]);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;
    const loadOrders = async () => {
      setLoadingOrders(true);
      try {
        const response = await authApiRequest("/api/orders/account", {
          method: "GET"
        });
        if (cancelled) return;
        const merged = Array.isArray(response?.orders) ? response.orders : [];
        setAccountOrders(merged);
      } catch (err) {
        if (!cancelled) {
          setStatus(err?.message || "Unable to load your past purchases right now.");
        }
      } finally {
        if (!cancelled) {
          setLoadingOrders(false);
        }
      }
    };

    loadOrders();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const upsertAccountOrder = (entry) => {
    setAccountOrders((prev) => {
      const next = [entry, ...prev.filter((item) => item.id !== entry.id)];
      next.sort((a, b) => getOrderTimestamp(b) - getOrderTimestamp(a));
      return next;
    });
  };

  const handleGoogleLogin = async () => {
    setStatus("");
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Auth error:", err);
      setStatus(`Google sign-in failed: ${err.code || err.message}`);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const applyOrderResult = (orderData, source = "order-id") => {
    if (!orderData?.id) return;
    const normalizedStatus = normalizeStatus(orderData.status);
    const paymentConfirmed = isPaymentConfirmed(orderData);
    const fullOrder = { ...orderData, locked: !paymentConfirmed };

    setOrder(fullOrder);
    setOrderId(orderData.id);
    rememberOrder(orderData.id, user?.uid);
    upsertAccountOrder(orderData);

    if (!paymentConfirmed) {
      if (isFailedStatus(normalizedStatus)) {
        setStatus("Payment failed or was cancelled. Please contact support if charged.");
      } else {
        setStatus(
          source === "mpesa-code"
            ? "Payment code found, but payment is not confirmed yet."
            : "Payment is not confirmed yet. Please check again shortly."
        );
      }
      return;
    }

    if (source === "mpesa-code") {
      setStatus("Payment confirmed. Your books are now available below.");
    } else {
      setStatus("");
    }
  };

  const loadOrderById = async (id, source = "order-id") => {
    const targetId = (id || "").trim();
    if (!targetId) {
      setStatus("Enter your order ID.");
      return;
    }

    setLoading(true);
    setStatus("");
    setOrder(null);
    try {
      const response = await authApiRequest("/api/orders/by-id", {
        method: "POST",
        body: {
          orderId: targetId,
          source,
          claimIfUnassigned: true
        }
      });
      applyOrderResult(response?.order, source);
    } catch (err) {
      setStatus(err?.message || "Unable to load order. Ensure it belongs to your account.");
    } finally {
      setLoading(false);
    }
  };

  const handleLookup = async (event) => {
    event.preventDefault();
    await loadOrderById(orderId, "order-id");
  };

  const handlePaymentFetch = async (event) => {
    event.preventDefault();
    setStatus("");
    setOrder(null);

    if (!user) {
      setStatus("Sign in to verify payment codes.");
      return;
    }

    const normalizedCode = normalizeTransactionCode(transactionCode);
    if (!normalizedCode) {
      setStatus("Enter your M-Pesa transaction code.");
      return;
    }

    setFetchingPayment(true);
    try {
      const response = await authApiRequest("/api/orders/by-transaction", {
        method: "POST",
        body: { code: normalizedCode }
      });
      applyOrderResult(response?.order, "mpesa-code");
    } catch (err) {
      setStatus(err?.message || "Unable to verify payment code right now. Please try again.");
    } finally {
      setFetchingPayment(false);
    }
  };

  return (
    <div className="page">
      <section className="panel">
        <SectionTitle
          title="Your Library"
          subtitle="Your purchases are private to your signed-in account."
        />

        {!user ? (
          <div className="auth-form center">
            <h3>Sign in to access your library</h3>
            <p className="muted">
              Please sign in with Google to view and download your purchased ebooks.
            </p>
            <button type="button" className="primary google" onClick={handleGoogleLogin}>
              Sign in with Google
            </button>
            {status && <p className="status">{status}</p>}
          </div>
        ) : (
          <>
            <div className="account-bar">
              <p>
                Signed in as <strong>{user.email}</strong>
              </p>
              <button type="button" className="ghost" onClick={handleLogout}>
                Sign out
              </button>
            </div>

            <div className="library-form">
              <div>
                <label>Orders on this account</label>
                <select
                  value={orderId}
                  onChange={(event) => setOrderId(event.target.value)}
                  disabled={loadingOrders || accountOrders.length === 0}
                >
                  {accountOrders.length ? (
                    accountOrders.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.id} - {isPaymentConfirmed(entry) ? "paid" : normalizeStatus(entry.status || "pending")}
                      </option>
                    ))
                  ) : (
                    <option value="">
                      {loadingOrders ? "Loading your orders..." : "No linked orders yet"}
                    </option>
                  )}
                </select>
              </div>
              <button
                type="button"
                className="ghost"
                disabled={!orderId || loading}
                onClick={() => loadOrderById(orderId, "order-id")}
              >
                Open selected
              </button>
            </div>

            <form className="library-form" onSubmit={handleLookup}>
              <div>
                <label>Order ID</label>
                <input
                  value={orderId}
                  onChange={(event) => setOrderId(event.target.value)}
                  placeholder="Enter your order ID"
                  required
                />
              </div>
              <button type="submit" className="primary" disabled={loading}>
                {loading ? "Checking..." : "Unlock library"}
              </button>
            </form>
            <form className="library-form" onSubmit={handlePaymentFetch}>
              <div>
                <label>M-Pesa transaction code</label>
                <input
                  value={transactionCode}
                  onChange={(event) => setTransactionCode(event.target.value)}
                  placeholder="e.g. QHG7A1B2C3"
                  required
                />
              </div>
              <button type="submit" className="ghost" disabled={fetchingPayment}>
                {fetchingPayment ? "Fetching..." : "Fetch payment"}
              </button>
            </form>
            {status && <p className="status">{status}</p>}

            {order && (
              <div className="order-card">
                <div className="order-header">
                  <div>
                    <h3>Order {order.id}</h3>
                    {order.payment?.transactionId ? (
                      <p className="muted">
                        M-Pesa code: <strong>{order.payment.transactionId}</strong>
                      </p>
                    ) : null}
                  </div>
                  <div>
                    <p className="muted">Total</p>
                    <strong>{formatCurrency(order.total)}</strong>
                  </div>
                </div>
                <div className="order-items">
                  {order.items?.map((item) => (
                    <div key={item.bookId || item.title} className="order-item">
                      <img
                        src={item.coverUrl || "/placeholder-cover.svg"}
                        alt={item.title}
                      />
                      <div>
                        <h4>{item.title}</h4>
                        <p className="muted">
                          {item.author} - Qty {item.qty || 1}
                        </p>
                        {order.locked ? (
                          <span className="muted">Payment pending</span>
                        ) : item.fileUrl ? (
                          <button
                            type="button"
                            className="primary"
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
                          <span className="muted">Download unavailable</span>
                        )}
                      </div>
                      <span className="price">
                        {formatCurrency(item.price * (item.qty || 1))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
