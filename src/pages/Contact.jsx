import { Link } from "react-router-dom";
import SectionTitle from "../components/SectionTitle.jsx";

const supportAreas = [
  "Order lookup and payment confirmation",
  "Download issues for PDF and EPUB files",
  "Duplicate charges or failed fulfillment",
  "Questions about digital delivery and access",
];

const helpChecklist = [
  "Sign in to your library before contacting support if your order is already linked to your account.",
  "Keep your order ID or M-Pesa receipt code ready so the team can trace the payment quickly.",
  "If payment has just been made, allow a short processing window before retrying the lookup.",
];

export default function Contact() {
  return (
    <div className="page">
      <section className="panel info-shell">
        <SectionTitle
          title="Contact Us"
          subtitle="Direct help for orders, payments, and library access."
        />

        <p className="info-intro">
          Isaac Books International supports digital purchases directly. For the
          fastest response, include the email used during checkout, your order
          ID, or your M-Pesa receipt code.
        </p>

        <div className="grid-2 info-grid">
          <article className="info-card">
            <h3>Support channels</h3>
            <div className="link-list">
              <a href="tel:+254111011300">+254 111 011 300</a>
              <a href="mailto:online.orders@isaacbooks.com">
                online.orders@isaacbooks.com
              </a>
            </div>
            <p>
              Use email for order history, delivery questions, and any issue that
              needs screenshots or payment details.
            </p>
          </article>

          <article className="info-card">
            <h3>What support covers</h3>
            <ul className="info-list">
              {supportAreas.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        </div>

        <div className="info-stack">
          <article className="info-card">
            <h3>Before you contact support</h3>
            <ul className="info-list">
              {helpChecklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </article>
        </div>

        <div className="about-cta">
          <h3>Need order access right now?</h3>
          <p className="muted">
            The library page lets you open account-linked orders and fetch an
            order using an ID or M-Pesa receipt code.
          </p>
          <Link to="/library" className="primary">
            Open your library
          </Link>
        </div>
      </section>
    </div>
  );
}
