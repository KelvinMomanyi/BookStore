import { useEffect, useMemo, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  where
} from "firebase/firestore";
import { db } from "../firebase.js";
import SectionTitle from "../components/SectionTitle.jsx";
import { formatCurrency } from "../utils/format.js";
import { isFailedStatus, isPaidStatus, normalizeStatus } from "../utils/orderStatus.js";

const loadStoredOrders = () => {
  try {
    return JSON.parse(localStorage.getItem("novaleaf_orders") || "[]");
  } catch {
    return [];
  }
};

const storeOrder = (id) => {
  if (!id) return;
  try {
    const existing = loadStoredOrders();
    const updated = [
      { id },
      ...existing.filter((entry) => {
        const entryId = typeof entry === "string" ? entry : entry?.id;
        return entryId && entryId !== id;
      })
    ].slice(0, 5);
    localStorage.setItem("novaleaf_orders", JSON.stringify(updated));
  } catch {
    // ignore local storage write errors
  }
};

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
  } catch { /* ignore */ }

  window.open(url, "_blank");
};

export default function Library() {
  const [orderId, setOrderId] = useState("");
  const [transactionCode, setTransactionCode] = useState("");
  const [order, setOrder] = useState(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetchingPayment, setFetchingPayment] = useState(false);
  const storedOrders = useMemo(loadStoredOrders, []);

  useEffect(() => {
    if (storedOrders.length > 0) {
      const first = storedOrders[0];
      setOrderId(typeof first === "string" ? first : first.id || "");
    }
  }, [storedOrders]);

  const applyOrderResult = (snap, source = "order-id") => {
    const data = snap.data();
    const normalizedStatus = normalizeStatus(data.status);
    const paymentConfirmed = isPaymentConfirmed(data);

    if (!paymentConfirmed) {
      if (isFailedStatus(normalizedStatus)) {
        setStatus("Payment failed or was cancelled. Please contact support if charged.");
      } else {
        setStatus(
          source === "mpesa-code"
            ? "Transaction code found, but payment is not confirmed yet."
            : "Payment is not confirmed yet. Please check again shortly."
        );
      }
      setOrder({ id: snap.id, ...data, locked: true });
      return;
    }

    setOrder({ id: snap.id, ...data, locked: false });
    setOrderId(snap.id);
    storeOrder(snap.id);

    if (source === "mpesa-code") {
      setStatus("Payment confirmed. Your books are now available below.");
    }
  };

  const handleLookup = async (event) => {
    event.preventDefault();
    setStatus("");
    setOrder(null);

    if (!orderId) {
      setStatus("Enter your order ID.");
      return;
    }

    setLoading(true);
    try {
      const snap = await getDoc(doc(db, "orders", orderId.trim()));
      if (!snap.exists()) {
        setStatus("Order not found.");
        return;
      }

      applyOrderResult(snap, "order-id");
    } catch (err) {
      setStatus("Unable to load order. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const handlePaymentFetch = async (event) => {
    event.preventDefault();
    setStatus("");
    setOrder(null);

    const normalizedCode = normalizeTransactionCode(transactionCode);
    if (!normalizedCode) {
      setStatus("Enter your M-Pesa transaction code.");
      return;
    }

    setFetchingPayment(true);
    try {
      const attempts = [...new Set([normalizedCode, normalizedCode.toLowerCase()])];
      let matchedDoc = null;

      for (const code of attempts) {
        const paymentQuery = query(
          collection(db, "orders"),
          where("payment.transactionId", "==", code),
          limit(1)
        );
        const snapshot = await getDocs(paymentQuery);
        if (!snapshot.empty) {
          matchedDoc = snapshot.docs[0];
          break;
        }
      }

      if (!matchedDoc) {
        setStatus("No payment found for that M-Pesa transaction code.");
        return;
      }

      applyOrderResult(matchedDoc, "mpesa-code");
    } catch (err) {
      setStatus("Unable to verify payment code right now. Please try again.");
    } finally {
      setFetchingPayment(false);
    }
  };

  return (
    <div className="page">
      <section className="panel">
        <SectionTitle
          title="Your Library"
          subtitle="Access purchased ebooks with your order ID or M-Pesa transaction code."
        />
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
      </section>
    </div>
  );
}


