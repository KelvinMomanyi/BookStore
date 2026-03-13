import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase.js";
import { useCart } from "../state/CartContext.jsx";
import { formatCurrency } from "../utils/format.js";

const storeOrder = (order) => {
  try {
    const existing = JSON.parse(localStorage.getItem("novaleaf_orders") || "[]");
    const updated = [order, ...existing].slice(0, 5);
    localStorage.setItem("novaleaf_orders", JSON.stringify(updated));
  } catch {
    // ignore
  }
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
  const [checkoutEmail, setCheckoutEmail] = useState("");
  const [orderId, setOrderId] = useState("");
  const [status, setStatus] = useState("");
  const [placing, setPlacing] = useState(false);

  const total = useMemo(() => summary.subtotal, [summary.subtotal]);

  const handleCheckout = async () => {
    setStatus("");
    setOrderId("");

    if (!items.length) return;
    if (!checkoutEmail.trim()) {
      setStatus("Enter your email for ebook delivery.");
      return;
    }

    setPlacing(true);
    try {
      const payload = {
        email: checkoutEmail.trim(),
        items: items.map((item) => ({
          bookId: item.id,
          title: item.title,
          author: item.author,
          price: item.price,
          qty: item.qty,
          coverUrl: item.coverUrl || "",
          fileUrl: item.fileUrl || ""
        })),
        total,
        createdAt: serverTimestamp(),
        status: "paid"
      };

      const docRef = await addDoc(collection(db, "orders"), payload);
      setOrderId(docRef.id);
      setStatus("Order placed. Save your order ID to access your library.");
      storeOrder({ id: docRef.id, email: payload.email });
      setCheckoutEmail("");
      clearCart();
    } catch (err) {
      setStatus("Checkout failed. Please try again.");
    } finally {
      setPlacing(false);
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
          <div className="checkout-email">
            <label>Delivery email</label>
            <input
              type="email"
              value={checkoutEmail}
              onChange={(event) => setCheckoutEmail(event.target.value)}
              placeholder="name@example.com"
            />
          </div>
          <button
            type="button"
            className="primary"
            onClick={handleCheckout}
            disabled={!items.length || placing}
          >
            {placing ? "Processing..." : "Complete Checkout"}
          </button>
          {status && <p className="status">{status}</p>}
          {orderId && (
            <div className="order-hint">
              <p>
                Order ID: <strong>{orderId}</strong>
              </p>
              <Link to="/library" className="ghost">
                Go to library
              </Link>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
