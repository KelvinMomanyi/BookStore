import { NavLink, Link } from "react-router-dom";
import { useCart } from "../state/CartContext.jsx";
import { useState, useEffect } from "react";
import { auth } from "../firebase.js";
import { onAuthStateChanged } from "firebase/auth";
import { isAdminUser } from "../utils/account.js";

const navLinkClass = ({ isActive }) =>
  isActive ? "nav-link active" : "nav-link";

export default function Navbar() {
  const { summary, toggleCart } = useCart();
  const [isAdmin, setIsAdmin] = useState(false);
  const aboutRoute = isAdmin ? "/admin" : "/about";

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setIsAdmin(isAdminUser(user));
    });
    return () => unsub();
  }, []);

  return (
    <header className="nav-shell">
      <div className="nav-blur" />
      <nav className="nav">
        <Link to="/" className="logo">
          <span className="logo-mark">I</span>
          <span className="logo-text">Isaac books international</span>
        </Link>
        <div className="nav-links">
          <NavLink to="/" className={navLinkClass} end>
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" role="img" focusable="false">
                <path
                  d="M4 11.5L12 4l8 7.5v7a1 1 0 0 1-1 1h-4.5a1 1 0 0 1-1-1v-4H10.5v4a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="nav-text">Home</span>
          </NavLink>
          <NavLink to="/store" className={navLinkClass}>
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" role="img" focusable="false">
                <path
                  d="M4 6h16l-1.5 6.5a2 2 0 0 1-2 1.5H7.5a2 2 0 0 1-2-1.5z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <path
                  d="M9 18a1.5 1.5 0 1 0 0 .01M16 18a1.5 1.5 0 1 0 0 .01"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="nav-text">Store</span>
          </NavLink>
          <NavLink to="/library" className={navLinkClass}>
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" role="img" focusable="false">
                <path
                  d="M6.5 5h10a2 2 0 0 1 2 2v11.5a1.5 1.5 0 0 0-1.5-1.5H8a2 2 0 0 0-2 2z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <path
                  d="M6.5 5a2 2 0 0 0-2 2v11a2 2 0 0 1 2-2h9.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span className="nav-text">Library</span>
          </NavLink>

          <NavLink to={aboutRoute} className={navLinkClass}>
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" role="img" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10"></circle>
                <path d="M12 16v-4"></path>
                <path d="M12 8h.01"></path>
              </svg>
            </span>
            <span className="nav-text">About Us</span>
          </NavLink>
        </div>
        <button type="button" className="cart-button" onClick={toggleCart}>
          Cart
          <span className="cart-count">{summary.count}</span>
        </button>
      </nav>
    </header>
  );
}
