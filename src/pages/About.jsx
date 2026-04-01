import { Link } from "react-router-dom";
import SectionTitle from "../components/SectionTitle.jsx";

export default function About() {
  return (
    <div className="page">
      <section className="panel about-shell">
        <SectionTitle
          title="About Us"
          subtitle="The team behind this product-first digital bookstore."
        />

        <div className="about-copy">
          <p>
            Welcome to <strong>Isaac Books International</strong>, your
            destination for high-quality digital literature, educational
            resources, and practical reads that create real impact.
          </p>
          <p>
            Our mission is to connect knowledge seekers with curated content and
            make every title easy to discover, purchase, and access from anywhere.
          </p>
          <p>
            Whether you are looking for academic materials, self-improvement
            guides, or captivating fiction, our catalog is selected to deliver
            clear value for every reader.
          </p>
          <p>
            Thank you for being part of our journey. Happy reading!
          </p>
        </div>

        <div className="about-cta">
          <h3>Get in touch</h3>
          <p className="muted">
            Have questions or need help with your digital library or an order?
          </p>
          <Link to="/contact" className="primary">
            Contact support
          </Link>
        </div>
      </section>
    </div>
  );
}
