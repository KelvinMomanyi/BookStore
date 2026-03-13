import { Link } from "react-router-dom";
import { formatCurrency } from "../utils/format.js";
import Badge from "./Badge.jsx";

export default function BookCard({ book, onAdd }) {
  return (
    <article className="book-card">
      <Link to={`/book/${book.id}`} className="book-cover">
        <img
          src={book.coverUrl || "/placeholder-cover.svg"}
          alt={book.title}
          loading="lazy"
        />
      </Link>
      <div className="book-info">
        <div>
          <h3>{book.title}</h3>
          <p className="muted">{book.author}</p>
        </div>
        <div className="book-meta">
          <Badge>{book.category || "Ebook"}</Badge>
          <span className="price">{formatCurrency(book.price)}</span>
        </div>
        <button type="button" className="primary" onClick={() => onAdd(book)}>
          Add to cart
        </button>
      </div>
    </article>
  );
}
