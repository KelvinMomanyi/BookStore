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
                      <a
                        className="primary"
                        href={buildDownloadUrl(
                          item.fileUrl,
                          buildDownloadName(item.fileUrl, item.title)
                        )}
                        download={buildDownloadName(item.fileUrl, item.title)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {buildDownloadLabel(item.fileUrl)}
                      </a>
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

