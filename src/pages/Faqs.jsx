import { Link } from "react-router-dom";
import SectionTitle from "../components/SectionTitle.jsx";

const faqs = [
  {
    question: "How do I receive my ebook after payment?",
    answer:
      "Once payment is confirmed, the order is unlocked in your library and the download button appears for each purchased title.",
  },
  {
    question: "Where can I find books I already bought?",
    answer:
      "Go to the library page, sign in with Google, and open your linked orders. You can also search using an order ID.",
  },
  {
    question: "Can I use my M-Pesa receipt code to find an order?",
    answer:
      "Yes. The library page includes a receipt-code lookup flow for confirmed payments that need to be attached to your account.",
  },
  {
    question: "Do I need an account to keep access to my purchases?",
    answer:
      "A signed-in account is the best way to reopen your purchases later because it keeps your orders tied to your personal library.",
  },
  {
    question: "Does this store ship physical books?",
    answer:
      "No. This storefront currently sells digital books only, so delivery happens online instead of through physical shipping.",
  },
  {
    question: "Can I request a refund?",
    answer:
      "Refunds for digital products are limited after delivery, but support can review duplicate charges, failed fulfillment, or incorrect files.",
  },
  {
    question: "What file types are available?",
    answer:
      "Available formats depend on the title. The library labels downloads as PDF, EPUB, or ebook when files are ready.",
  },
];

export default function Faqs() {
  return (
    <div className="page">
      <section className="panel info-shell">
        <SectionTitle
          title="Frequently Asked Questions"
          subtitle="Answers to the most common order, delivery, and access questions."
        />

        <div className="faq-stack">
          {faqs.map((item) => (
            <article key={item.question} className="faq-item">
              <h3>{item.question}</h3>
              <p>{item.answer}</p>
            </article>
          ))}
        </div>

        <div className="about-cta">
          <h3>Still need help?</h3>
          <p className="muted">
            If your question is specific to a payment or a missing download, the
            support page is the right next step.
          </p>
          <Link to="/contact" className="primary">
            Contact support
          </Link>
        </div>
      </section>
    </div>
  );
}
