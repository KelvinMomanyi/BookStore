import { Link } from "react-router-dom";

export default function Footer() {
  const year = new Date().getFullYear();
  const whatsappNumber = (import.meta.env.VITE_AUTHOR_WHATSAPP_NUMBER || "")
    .toString()
    .replace(/\D/g, "");
  const whatsappHref = whatsappNumber
    ? `https://wa.me/${whatsappNumber}`
    : "https://wa.me/";

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
            <a
              href={whatsappHref}
              target="_blank"
              rel="noreferrer"
              className="whatsapp-link"
              aria-label="Chat with the author on WhatsApp"
            >
              <span className="whatsapp-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" role="img" focusable="false">
                  <path d="M20.52 3.49A11.86 11.86 0 0012.07 0C5.56 0 .27 5.3.27 11.8c0 2.08.54 4.11 1.58 5.9L0 24l6.49-1.7a11.8 11.8 0 005.58 1.42h.01c6.51 0 11.8-5.3 11.8-11.8 0-3.15-1.23-6.12-3.36-8.43zM12.08 21.7h-.01a9.84 9.84 0 01-5.01-1.37l-.36-.22-3.85 1.01 1.03-3.76-.24-.39a9.82 9.82 0 01-1.5-5.17c0-5.43 4.43-9.85 9.87-9.85 2.63 0 5.1 1.02 6.96 2.9a9.77 9.77 0 012.88 6.95c0 5.43-4.44 9.85-9.87 9.85zm5.4-7.38c-.3-.15-1.77-.87-2.04-.97-.28-.1-.48-.15-.68.15-.2.3-.78.97-.95 1.17-.18.2-.35.23-.65.08-.3-.15-1.25-.46-2.37-1.47-.88-.78-1.47-1.74-1.64-2.03-.17-.3-.02-.46.13-.6.14-.14.3-.35.45-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.68-1.65-.94-2.27-.25-.6-.5-.52-.68-.53l-.58-.01c-.2 0-.52.08-.79.37-.27.3-1.04 1.01-1.04 2.47 0 1.45 1.06 2.86 1.2 3.06.15.2 2.1 3.2 5.08 4.48.71.3 1.27.48 1.7.62.71.22 1.36.19 1.88.11.57-.08 1.77-.72 2.02-1.42.25-.7.25-1.3.18-1.42-.08-.12-.28-.2-.58-.35z" />
                </svg>
              </span>
              <span>Chat on WhatsApp</span>
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
