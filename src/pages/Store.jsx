import { useMemo, useState } from "react";
import { useBooks } from "../hooks/useBooks.js";
import BookGrid from "../components/BookGrid.jsx";
import SectionTitle from "../components/SectionTitle.jsx";
import { useCart } from "../state/CartContext.jsx";

const normalize = (value) => value.toLowerCase().trim();

export default function Store() {
  const { books, loading, error } = useBooks();
  const { addToCart } = useCart();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");

  const categories = useMemo(() => {
    const unique = new Set(["All"]);
    books.forEach((book) => {
      if (book.category) unique.add(book.category);
    });
    return Array.from(unique);
  }, [books]);

  const filtered = useMemo(() => {
    const q = normalize(query);
    return books.filter((book) => {
      const matchesQuery =
        !q ||
        normalize(book.title).includes(q) ||
        normalize(book.author || "").includes(q);
      const matchesCategory =
        category === "All" || book.category === category;
      return matchesQuery && matchesCategory;
    });
  }, [books, query, category]);

  return (
    <div className="page">
      <section className="panel">
        <SectionTitle
          title="Browse the bookstore"
          subtitle="Find your next read by genre, author, or collection."
        />
        <div className="filters">
          <input
            type="search"
            placeholder="Search by title or author"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="chip-row">
            {categories.map((item) => (
              <button
                key={item}
                type="button"
                className={`chip ${item === category ? "active" : ""}`}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        {loading && <p className="empty">Loading the catalog...</p>}
        {error && <p className="empty">Unable to load books right now.</p>}
        {!loading && !error && (
          <BookGrid books={filtered} onAdd={addToCart} />
        )}
      </section>
    </div>
  );
}
