import { useMemo, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "../firebase.js";
import { useCart } from "../state/CartContext.jsx";
import { formatCurrency } from "../utils/format.js";
import { initiateStkPush, setupSocket } from "../utils/paymentService.js";

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
  const [phoneNumber, setPhoneNumber] = useState("");
  const [orderId, setOrderId] = useState("");
  const [status, setStatus] = useState("");
  const [placing, setPlacing] = useState(false);
  const [purchasedItems, setPurchasedItems] = useState([]);
  const [socket, setSocket] = useState(null);

  const total = useMemo(() => summary.subtotal, [summary.subtotal]);

  useEffect(() => {
    // Cleanup socket on unmount
    return () => {
      if (socket) {
        socket.disconnect();
      }
    };
  }, [socket]);

  const handleCheckout = async () => {
    setStatus("");
    setOrderId("");

    if (!items.length) return;
    if (!checkoutEmail.trim()) {
      setStatus("Enter your email for ebook delivery.");
      return;
    }
    if (!phoneNumber.trim()) {
      setStatus("Enter your M-Pesa phone number.");
      return;
    }

    setPlacing(true);
    setStatus("Connecting to payment system...");

    try {
      // 1. Setup Socket
      const newSocket = setupSocket();
      setSocket(newSocket);

      // Functional way to wait for connection
      newSocket.on("connect", async () => {
        const socketId = newSocket.id;
        setStatus("Initiating M-Pesa STK Push...");

        try {
          // 2. Initiate STK Push
          await initiateStkPush({
            phoneNumber: phoneNumber.trim(),
            amount: total,
            userId: checkoutEmail.trim(), // Using email as a temporary userId
            socketId: socketId
          });

          setStatus("Please check your phone and enter your M-Pesa PIN.");

          // 3. Listen for payment status
          newSocket.on("payment_success", async (data) => {
            setStatus("Payment confirmed! Finishing your order...");
            
            const payload = {
              email: checkoutEmail.trim(),
              phoneNumber: phoneNumber.trim(),
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
              status: "paid",
              transactionId: data.CheckoutRequestID || ""
            };

            const docRef = await addDoc(collection(db, "orders"), payload);
            const purchasedItems = items.map(item => ({...item}));
            
            setStatus("Success! Your ebooks are ready.");
            setPlacing(false);
            setOrderId(docRef.id);
            setPurchasedItems(purchasedItems); // New state to show what was bought
            
            storeOrder({ id: docRef.id, email: payload.email });
            setCheckoutEmail("");
            setPhoneNumber("");
            clearCart();
            newSocket.disconnect();
          });

          newSocket.on("payment_failed", (error) => {
            setStatus(`Payment failed: ${error.message || "Payment cancelled or timed out."}`);
            setPlacing(false);
            newSocket.disconnect();
          });

        } catch (err) {
          setStatus(`Failed to start payment: ${err.message}`);
          setPlacing(false);
          newSocket.disconnect();
        }
      });

      // Handle connection errors
      newSocket.on("connect_error", (err) => {
        setStatus("Failed to connect to payment server.");
        setPlacing(false);
      });

    } catch (err) {
      setStatus("Checkout failed. Please check your connection.");
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
          <div className="checkout-fields">
            <div className="checkout-email">
              <label>Delivery email</label>
              <input
                type="email"
                value={checkoutEmail}
                onChange={(event) => setCheckoutEmail(event.target.value)}
                placeholder="name@example.com"
                disabled={placing}
              />
            </div>
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
              <div className="purchased-list">
                {purchasedItems.map((item) => (
                  <div key={item.id} className="purchased-item">
                    <span>{item.title}</span>
                    {item.fileUrl ? (
                      <a href={item.fileUrl} target="_blank" rel="noreferrer" className="download-btn">
                        Download
                      </a>
                    ) : (
                      <span className="muted">Processing file...</span>
                    )}
                  </div>
                ))}
              </div>
              <div className="order-hint">
                <p>
                  Order ID: <strong>{orderId}</strong>
                </p>
                <Link to="/library" className="ghost" onClick={closeCart}>
                  Go to library
                </Link>
              </div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

