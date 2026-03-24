import BookCard from "./BookCard.jsx";

export default function BookGrid({ books, onAdd }) {
  if (!books.length) {
    return <p className="empty">No products match this selection yet.</p>;
  }

  return (
    <div className="book-grid">
      {books.map((book) => (
        <BookCard key={book.id} book={book} onAdd={onAdd} />
      ))}
    </div>
  );
}
