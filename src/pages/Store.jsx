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
  const [sortBy, setSortBy] = useState("featured");

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

  const sortedBooks = useMemo(() => {
    const list = [...filtered];
    if (sortBy === "price-low") {
      return list.sort((a, b) => (a.price || 0) - (b.price || 0));
    }
    if (sortBy === "price-high") {
      return list.sort((a, b) => (b.price || 0) - (a.price || 0));
    }
    if (sortBy === "title") {
      return list.sort((a, b) =>
        (a.title || "").localeCompare(b.title || "", undefined, {
          sensitivity: "base"
        })
      );
    }
    return list;
  }, [filtered, sortBy]);

  return (
    <div className="page">
      <section className="panel">
        <SectionTitle
          title="Shop the ebook catalog"
          subtitle="Browse, filter, and compare products before you add them to cart."
        />
        <div className="store-layout">
          <div className="filters">
            <div>
              <label htmlFor="store-search">Search products</label>
              <input
                id="store-search"
                type="search"
                placeholder="Title or author"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div>
              <label>Categories</label>
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
          </div>
          <div className="store-results">
            <div className="store-toolbar">
              <p className="muted">
                {!loading && !error
                  ? `${sortedBooks.length} product${sortedBooks.length === 1 ? "" : "s"}`
                  : "Updating products..."}
              </p>
              <label className="sort-control">
                Sort by
                <select
                  value={sortBy}
                  onChange={(event) => setSortBy(event.target.value)}
                >
                  <option value="featured">Featured</option>
                  <option value="price-low">Price: Low to High</option>
                  <option value="price-high">Price: High to Low</option>
                  <option value="title">Title: A to Z</option>
                </select>
              </label>
            </div>
            {loading && <p className="empty">Loading the catalog...</p>}
            {error && <p className="empty">Unable to load products right now.</p>}
            {!loading && !error && (
              <BookGrid books={sortedBooks} onAdd={addToCart} />
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
