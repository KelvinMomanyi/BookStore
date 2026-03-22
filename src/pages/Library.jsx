import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
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
  const [order, setOrder] = useState(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const storedOrders = useMemo(loadStoredOrders, []);

  useEffect(() => {
    if (storedOrders.length > 0) {
      const first = storedOrders[0];
      setOrderId(typeof first === "string" ? first : first.id || "");
    }
  }, [storedOrders]);

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

      const data = snap.data();
      const normalizedStatus = normalizeStatus(data.status);
      if (!isPaidStatus(normalizedStatus)) {
        if (isFailedStatus(normalizedStatus)) {
          setStatus("Payment failed or was cancelled. Please contact support if charged.");
        } else {
          setStatus("Payment is not confirmed yet. Please check again shortly.");
        }
        setOrder({ id: snap.id, ...data, locked: true });
        return;
      }

      setOrder({ id: snap.id, ...data, locked: false });
    } catch (err) {
      setStatus("Unable to load order. Try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page">
      <section className="panel">
        <SectionTitle
          title="Your Library"
          subtitle="Access your purchased ebooks with your order ID."
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
        {status && <p className="status">{status}</p>}

        {order && (
          <div className="order-card">
            <div className="order-header">
              <div>
                <h3>Order {order.id}</h3>
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
                      {item.author} · Qty {item.qty || 1}
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

