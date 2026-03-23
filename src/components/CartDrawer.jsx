import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useCart } from "../state/CartContext.jsx";
import { formatCurrency } from "../utils/format.js";

export default function CartDrawer() {
  const {
    items,
    isOpen,
    closeCart,
    removeFromCart,
    updateQty,
    summary
  } = useCart();
  const navigate = useNavigate();
  const total = useMemo(() => summary.subtotal, [summary.subtotal]);

  const handleProceedToCheckout = () => {
    if (!items.length) return;
    closeCart();
    navigate("/checkout");
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
          <button
            type="button"
            className="primary"
            onClick={handleProceedToCheckout}
            disabled={!items.length}
          >
            Proceed to checkout
          </button>
          <p className="muted">Payment is completed on the checkout page.</p>
        </div>
      </aside>
    </div>
  );
}
