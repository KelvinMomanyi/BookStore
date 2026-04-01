import SectionTitle from "../components/SectionTitle.jsx";

const sections = [
  {
    title: "Use of the storefront",
    points: [
      "This site is intended for browsing, purchasing, and accessing digital books from Isaac Books International.",
      "You agree to provide accurate checkout and account information when placing an order or linking purchases to your library.",
    ],
  },
  {
    title: "Orders and payments",
    points: [
      "Orders are processed after payment initiation and are fulfilled when payment confirmation is received.",
      "If a payment fails, remains pending, or is interrupted, access may be delayed until the transaction is verified.",
    ],
  },
  {
    title: "Digital access and licensing",
    points: [
      "Purchased ebooks are licensed to the buyer for personal use unless a different license is stated for a specific title.",
      "You may not redistribute, resell, or publicly upload files obtained through this store.",
    ],
  },
  {
    title: "Accounts and security",
    points: [
      "You are responsible for keeping access to your sign-in account secure.",
      "The store may limit or suspend access where misuse, fraud, or unauthorized sharing is detected.",
    ],
  },
  {
    title: "Policy updates",
    points: [
      "Terms may be updated as the store evolves. Continued use of the storefront after updates means you accept the revised terms.",
      "Questions about these terms can be directed to online.orders@isaacbooks.com.",
    ],
  },
];

export default function Terms() {
  return (
    <div className="page">
      <section className="panel info-shell">
        <SectionTitle
          title="Terms & Conditions"
          subtitle="Basic rules for using the storefront, placing orders, and accessing digital books."
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
