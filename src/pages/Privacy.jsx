import SectionTitle from "../components/SectionTitle.jsx";

const sections = [
  {
    title: "Information the store uses",
    points: [
      "Contact details such as email address and phone number when provided during checkout or support conversations.",
      "Order and payment reference data needed to verify purchases and unlock digital access.",
      "Account identifiers used to connect confirmed purchases to your library.",
    ],
  },
  {
    title: "How information is used",
    points: [
      "To process orders, confirm payments, and deliver purchased ebooks.",
      "To help with customer support, order lookup, refunds review, and access restoration.",
      "To maintain storefront security and reduce misuse or payment fraud.",
    ],
  },
  {
    title: "Payment and third-party services",
    points: [
      "Payments and supporting infrastructure may involve trusted third-party providers used by the storefront.",
      "Only the information needed to complete and verify purchases is shared with those services.",
    ],
  },
  {
    title: "Retention and protection",
    points: [
      "Order data may be retained to support future access, support requests, and business records.",
      "Reasonable technical steps are taken to protect stored information, but no online system can promise absolute security.",
    ],
  },
  {
    title: "Questions about privacy",
    points: [
      "If you need help understanding how your order data is handled, contact online.orders@isaacbooks.com.",
      "Privacy terms may change when the storefront adds new features or operational requirements.",
    ],
  },
];

export default function Privacy() {
  return (
    <div className="page">
      <section className="panel info-shell">
        <SectionTitle
          title="Privacy Policy"
          subtitle="How the storefront handles order, account, and support information."
        />

        <div className="policy-stack">
          {sections.map((section) => (
            <article key={section.title} className="policy-section">
              <h3>{section.title}</h3>
              <ul className="info-list">
                {section.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
