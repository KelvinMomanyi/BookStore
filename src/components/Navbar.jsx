import { NavLink, Link } from "react-router-dom";
import { useCart } from "../state/CartContext.jsx";

const navLinkClass = ({ isActive }) =>
  isActive ? "nav-link active" : "nav-link";

export default function Navbar() {
  const { summary, toggleCart } = useCart();

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
          <NavLink to="/admin" className={navLinkClass}>
            <span className="nav-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" role="img" focusable="false">
                <path
                  d="M12 4l7 3v5c0 4-3 7-7 8-4-1-7-4-7-8V7z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <path
                  d="M9.5 12.5l1.7 1.7 3.5-3.6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="nav-text">Admin</span>
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
