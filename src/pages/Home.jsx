import { Link } from "react-router-dom";
import { useBooks } from "../hooks/useBooks.js";
import BookGrid from "../components/BookGrid.jsx";
import SectionTitle from "../components/SectionTitle.jsx";
import { useCart } from "../state/CartContext.jsx";

export default function Home() {
  const { books, loading } = useBooks(12);
  const { addToCart } = useCart();

  return (
    <div className="page">
      <section className="hero">
        <div className="hero-copy">
          <p className="kicker">Maktaba yako ya kidijitali</p>
          <h1>
            Build your private library with instant-delivery ebooks.
          </h1>
          <p className="subtext">
            Vitabu Kenya brings together the best works from local authors and
            international classics with a seamless mobile payment experience.
          </p>
          <div className="hero-actions">
            <Link to="/store" className="primary">
              Browse the bookstore
            </Link>
            <Link to="/admin" className="ghost">
              Upload new titles
            </Link>
          </div>
        </div>
        <div className="hero-card">
          <div className="gradient-card">
            <h3>Signature Bundles</h3>
            <p>Curated collections with exclusive author notes.</p>
            <ul>
              <li>Kenyan author playlists</li>
              <li>Audio companion notes</li>
              <li>Guided reading rituals</li>
            </ul>
            <button className="primary" type="button">
              Explore bundles
            </button>
          </div>
          <div className="floating-card">
            <p className="kicker">Inayovuma sasa</p>
            <h4>Kesho Yetu</h4>
            <span>na Wangari Maathai</span>
          </div>
        </div>
      </section>

      <section className="panel">
        <SectionTitle
          title="Fresh Arrivals"
          subtitle="New releases from Kenyan and global authors."
        />
        {loading ? (
          <p className="empty">Loading the latest ebooks...</p>
        ) : (
          <BookGrid books={books} onAdd={addToCart} />
        )}
      </section>

      <section className="panel alt center">
        <Link to="/store" className="primary" style={{ fontSize: '1.2rem', padding: '16px 32px' }}>
          Explore full catalog
        </Link>
      </section>
    </div>
  );
}
