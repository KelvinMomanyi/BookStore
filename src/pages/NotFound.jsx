import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="page">
      <div className="panel center">
        <h2>Page not found</h2>
        <p className="muted">This route does not exist yet.</p>
        <Link className="ghost" to="/">
          Back home
        </Link>
      </div>
    </div>
  );
}
