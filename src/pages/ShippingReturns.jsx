import SectionTitle from "../components/SectionTitle.jsx";

const sections = [
  {
    title: "Digital delivery",
    body:
      "Isaac Books International sells digital books. There is no physical shipping, and access is provided online after payment is confirmed.",
  },
  {
    title: "When delivery happens",
    body:
      "Most orders become available shortly after successful payment. If confirmation is delayed, use the library page to check the order again or fetch it with an M-Pesa receipt code.",
  },
  {
    title: "Returns and refunds",
    body:
      "Because digital files can be accessed immediately, returns are limited once delivery is complete. Support may still review duplicate charges, failed fulfillment, or cases where the delivered file is incorrect or unavailable.",
  },
  {
    title: "Download issues",
    body:
      "If a paid order does not unlock correctly, contact support with your order ID, receipt code, and the email used during checkout so the team can investigate quickly.",
  },
];

export default function ShippingReturns() {
  return (
    <div className="page">
      <section className="panel info-shell">
        <SectionTitle
          title="Shipping & Returns"
          subtitle="How digital delivery, access timing, and refund handling work."
        />

        <div className="policy-stack">
          {sections.map((section) => (
            <article key={section.title} className="policy-section">
              <h3>{section.title}</h3>
              <p>{section.body}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
