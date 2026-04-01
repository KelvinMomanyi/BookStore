import { Link } from "react-router-dom";
import { useBooks } from "../hooks/useBooks.js";
import BookGrid from "../components/BookGrid.jsx";
import SectionTitle from "../components/SectionTitle.jsx";
import { useCart } from "../state/CartContext.jsx";
import { formatCurrency } from "../utils/format.js";

export default function Home() {
  const { books, loading } = useBooks(24);
  const { addToCart } = useCart();
  const heroMotionBooks = books.slice(0, 4);
  const spotlightBooks = books.slice(0, 6);
  const featuredBooks = books.slice(0, 12);
  const newestBooks = books.slice(12, 20).length
    ? books.slice(12, 20)
    : books.slice(0, 8);
  const archiveBooks = books.slice(20, 28).length
    ? books.slice(20, 28)
    : books.slice(4, 12);

  return (
    <div className="page">
      <section className="hero hero-classic">
        <div className="hero-copy author-note">
          {!loading && heroMotionBooks.length ? (
            <div className="author-float-layer" aria-hidden="true">
              <div className="author-float-glow" />
              <div className="author-float-track">
                {heroMotionBooks.map((book, index) => (
                  <div
                    key={`${book.id}-author-float`}
                    className="author-book"
                    style={{ "--author-book-delay": `${0.08 + index * 0.12}s` }}
                  >
                    <div className="author-book-frame">
                      <img
                        src={book.coverUrl || "/placeholder-cover.svg"}
                        alt=""
                        loading={index === 0 ? "eager" : "lazy"}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          <p className="kicker">Author storefront</p>
          <h1>Own the complete collection from a single author storefront.</h1>
          <p className="subtext">
            Discover books authored and published under Isaac books international.
            Browse by cover, compare editions, and purchase directly from the writer
            with instant digital delivery after checkout.
          </p>
          <div className="hero-actions">
            <Link to="/store" className="primary">
              Browse all books
            </Link>
            <Link to="/library" className="ghost">
              View your library
            </Link>
          </div>
        </div>
        <aside className="classic-shelf">
          <h3>Front shelf</h3>
          <div className="shelf-strip">
            {loading ? (
              <p className="muted">Loading featured books...</p>
            ) : spotlightBooks.length ? (
              spotlightBooks.map((book) => (
                <article key={book.id} className="shelf-item">
                  <Link to={`/book/${book.id}`} className="shelf-cover">
                    <img
                      src={book.coverUrl || "/placeholder-cover.svg"}
                      alt={book.title}
                      loading="lazy"
                    />
                  </Link>
                  <div className="shelf-meta">
                    <p className="shelf-title">{book.title}</p>
                    <p className="muted">{book.author}</p>
                    <span className="price">{formatCurrency(book.price)}</span>
                  </div>
                </article>
              ))
            ) : (
              <p className="muted">Fresh products will appear here soon.</p>
            )}
          </div>
        </aside>
      </section>

      <section className="panel">
        <div className="section-row">
          <SectionTitle
            title="Featured collection"
            subtitle="Core titles from the author catalog."
          />
          <Link to="/store" className="ghost">
            Shop full catalog
          </Link>
        </div>
        {loading ? (
          <p className="empty">Loading featured books...</p>
        ) : (
          <BookGrid books={featuredBooks} onAdd={addToCart} />
        )}
      </section>

      <section className="panel">
        <SectionTitle
          title="New on the shelf"
          subtitle="Recently added books and new editions."
        />
        {loading ? (
          <p className="empty">Loading latest books...</p>
        ) : (
          <BookGrid books={newestBooks} onAdd={addToCart} />
        )}
      </section>

      <section className="panel alt">
        <SectionTitle
          title="Author archive"
          subtitle="Backlist books, evergreen guides, and timeless reads."
        />
        {loading ? (
          <p className="empty">Loading archive books...</p>
        ) : (
          <BookGrid books={archiveBooks} onAdd={addToCart} />
        )}
      </section>
    </div>
  );
}
