import { useEffect, useMemo, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import SectionTitle from "../components/SectionTitle.jsx";
import { formatCurrency } from "../utils/format.js";

const loadStoredOrders = () => {
  try {
    return JSON.parse(localStorage.getItem("novaleaf_orders") || "[]");
  } catch {
    return [];
  }
};

export default function Library() {
  const [orderId, setOrderId] = useState("");
  const [email, setEmail] = useState("");
  const [order, setOrder] = useState(null);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);
  const storedOrders = useMemo(loadStoredOrders, []);

  useEffect(() => {
    if (storedOrders.length > 0) {
      setOrderId(storedOrders[0].id);
      setEmail(storedOrders[0].email);
    }
  }, [storedOrders]);

  const handleLookup = async (event) => {
    event.preventDefault();
    setStatus("");
    setOrder(null);

    if (!orderId || !email) {
      setStatus("Enter both order ID and email.");
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
      if (data.email?.toLowerCase() !== email.trim().toLowerCase()) {
        setStatus("Email does not match this order.");
        return;
      }

      setOrder({ id: snap.id, ...data });
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
          subtitle="Access your purchased ebooks with your order ID and email."
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
          <div>
            <label>Email</label>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
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
                <p className="muted">{order.email}</p>
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
                    {item.fileUrl ? (
                      <a
                        className="primary"
                        href={item.fileUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Download now
                      </a>
                    ) : (
                      <span className="muted">Download unavailable</span>
                    )}抽
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
