import { Link } from "react-router-dom";

const footerGroups = [
  {
    title: "Customer service",
    links: [
      { to: "/contact", label: "Contact Us" },
      { to: "/faqs", label: "FAQs" },
      { to: "/library", label: "My Library" },
    ],
  },
  {
    title: "Discover",
    links: [
      { to: "/store", label: "Browse Catalog" },
      { to: "/about", label: "Our Story" },
    ],
  },
  {
    title: "Our Policies",
    links: [
      { to: "/shipping-returns", label: "Shipping & Returns" },
      { to: "/terms", label: "Terms & Conditions" },
      { to: "/privacy", label: "Privacy Policy" },
    ],
  },
];

export default function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="footer-new">
      <div className="footer-new-inner">
        <div className="footer-grid-5">
          {footerGroups.map((group) => (
            <div key={group.title} className="footer-col-new">
              <h4>{group.title}</h4>
              {group.links.map((link) => (
                <Link key={link.to} to={link.to}>
                  {link.label}
                </Link>
              ))}
            </div>
          ))}

          <div className="footer-col-new footer-contact">
            <h4>Get in Touch</h4>
            <a href="tel:+254111011300" className="contact-item">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
              +254 111 011 300
            </a>
            <a href="mailto:online.orders@isaacbooks.com" className="contact-item">
              <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><polyline points="22,6 12,13 2,6"></polyline></svg>
              online.orders@isaacbooks.com
            </a>
            <p>Digital bookstore support for orders, payments, and downloads.</p>
            <Link to="/contact">Support center</Link>
          </div>
        </div>

        <div className="footer-bottom-new">
          <p>&copy; {year} Isaac books international. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
