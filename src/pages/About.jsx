import SectionTitle from "../components/SectionTitle.jsx";

export default function About() {
  return (
    <div className="page">
      <section className="panel" style={{ maxWidth: "800px", margin: "0 auto" }}>
        <SectionTitle
          title="About Us"
          subtitle="Discover the story behind Isaac Books International."
        />
        
        <div style={{ lineHeight: "1.8", color: "var(--color-text-muted)" }}>
          <p style={{ marginBottom: "1.5rem" }}>
            Welcome to <strong>Isaac Books International</strong>, your premier destination for high-quality digital literature, educational resources, and transformative reading experiences. 
          </p>
          <p style={{ marginBottom: "1.5rem" }}>
            Our mission is to bridge the gap between knowledge seekers and world-class content. We believe that digital access to well-curated books empowers minds, accelerates growth, and fosters a global community of lifelong learners.
          </p>
          <p style={{ marginBottom: "1.5rem" }}>
            Whether you're looking for academic materials, self-improvement guides, or captivating fiction, we strive to bring the best titles right to your fingertips. Every book in our collection is carefully selected to ensure you receive the highest value.
          </p>
          <p>
            Thank you for being part of our journey. Happy reading!
          </p>
        </div>
        
        <div style={{ marginTop: "3rem", padding: "2rem", background: "var(--color-surface-hover)", borderRadius: "var(--radius-md)", textAlign: "center" }}>
          <h3 style={{ color: "var(--color-text)", marginBottom: "1rem" }}>Get in Touch</h3>
          <p style={{ marginBottom: "1rem" }}>Have questions or need assistance with your digital library?</p>
          <a href="mailto:contact@isaacbooks.com" className="primary button" style={{ display: "inline-block", textDecoration: "none" }}>Contact Support</a>
        </div>
      </section>
    </div>
  );
}
