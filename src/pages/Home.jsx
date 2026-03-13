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
          <div className="hero-actions">
            <Link to="/store" className="primary">
              Browse the bookstore
            </Link>
            <Link to="/admin" className="ghost">
              Upload new titles
            </Link>
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
