import { Link } from "react-router-dom";

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-brand">
          <span className="footer-logo">I</span>
          <div>
            <h3>Isaac books international</h3>
            <p>
              A global digital bookstore delivering ebooks instantly to readers,
              students, and professionals.
            </p>
          </div>
        </div>

        <div className="footer-grid">
          <div className="footer-col">
            <h4>Browse</h4>
            <Link to="/">Home</Link>
            <Link to="/store">Store</Link>
            <Link to="/library">Library</Link>
          </div>

          <div className="footer-col">
            <h4>Company</h4>
            <p>Instant delivery</p>
            <p>Secure checkout</p>
            <p>Worldwide access</p>
          </div>

          <div className="footer-col">
            <h4>Support</h4>
            <a href="mailto:hello@isaacbooksinternational.com">
              hello@isaacbooksinternational.com
            </a>
            <p>Mon - Sat: 8:00 AM - 8:00 PM</p>
          </div>
        </div>

        <div className="footer-bottom">
          <p>Copyright {year} Isaac books international. All rights reserved.</p>
          <p>Digital bookstore for modern readers.</p>
        </div>
      </div>
    </footer>
  );
}
