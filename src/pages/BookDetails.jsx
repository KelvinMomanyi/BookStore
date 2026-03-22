import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../firebase.js";
import { useCart } from "../state/CartContext.jsx";
import { formatCurrency } from "../utils/format.js";
import Badge from "../components/Badge.jsx";

export default function BookDetails() {
  const { id } = useParams();
  const { addToCart } = useCart();
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const load = async () => {
      try {
        const snap = await getDoc(doc(db, "books", id));
        if (snap.exists() && isMounted) {
          setBook({ id: snap.id, ...snap.data() });
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    load();
    return () => {
      isMounted = false;
    };
  }, [id]);

  if (loading) {
    return <p className="empty">Loading ebook details...</p>;
  }

  if (!book) {
    return (
      <div className="page">
        <p className="empty">We could not find that ebook.</p>
        <Link to="/store" className="ghost">
          Back to the bookstore
        </Link>
      </div>
    );
  }

  return (
    <div className="page">
      <section className="details">
        <div className="details-cover">
          <img
            src={book.coverUrl || "/placeholder-cover.svg"}
            alt={book.title}
          />
        </div>
        <div className="details-copy">
          <Badge>{book.category || "Ebook"}</Badge>
          <h1>{book.title}</h1>
          <p className="muted">by {book.author}</p>
          <p className="details-description">
            {book.description ||
              "A beautifully digital ebook curated by Isaac books international."}
          </p>
          <div className="details-actions">
            <span className="price">{formatCurrency(book.price)}</span>
            <button type="button" className="primary" onClick={() => addToCart(book)}>
              Add to cart
            </button>
          </div>
          <div className="details-list">
            <div>
              <strong>Format</strong>
              <span>{book.format || "PDF / EPUB"}</span>
            </div>
            <div>
              <strong>Access</strong>
              <span>Instant download after checkout</span>
            </div>
            <div>
              <strong>License</strong>
              <span>For personal use</span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
