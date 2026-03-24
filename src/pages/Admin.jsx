import { useEffect, useMemo, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from "firebase/auth";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  updateDoc
} from "firebase/firestore";
import { auth, db } from "../firebase.js";
import SectionTitle from "../components/SectionTitle.jsx";
import { formatCurrency } from "../utils/format.js";
import { isAdminUser } from "../utils/account.js";
import { authApiRequest } from "../utils/secureApi.js";

const initialForm = {
  title: "",
  author: "",
  price: "",
  category: "",
  description: "",
  format: "PDF / EPUB",
  coverUrl: "",
  fileUrl: ""
};

const toCreatedAtMs = (value) => {
  if (typeof value === "number") return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  return 0;
};

const mapBookSnapshot = (snap) => {
  const data = snap.data() || {};
  return {
    id: snap.id,
    ...data,
    createdAtMs: toCreatedAtMs(data.createdAt)
  };
};

const mapApiBook = (book) => ({
  ...(book || {}),
  createdAtMs: toCreatedAtMs(book?.createdAtMs ?? book?.createdAt)
});

const sortBooksByCreatedAt = (books) =>
  [...books].sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));

const getErrorMessage = (err) => (err?.message || "").toString();

const shouldUseClientFallback = (err) => {
  const message = getErrorMessage(err).toLowerCase();
  return (
    message.includes("admin books request failed") ||
    message.includes("admin access required") ||
    message.includes("missing firebase admin credentials") ||
    message.includes("request failed with status 500") ||
    message.includes("request failed with status 404")
  );
};

export default function Admin() {
  const [user, setUser] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [ebookFile, setEbookFile] = useState(null);
  const [coverFile, setCoverFile] = useState(null);
  const [ebookProgress, setEbookProgress] = useState(0);
  const [coverProgress, setCoverProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [books, setBooks] = useState([]);
  const [loadingBooks, setLoadingBooks] = useState(false);
  const [editId, setEditId] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const isAdmin = isAdminUser(user);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser || null);
    });
    return () => unsub();
  }, []);

  const loadBooksFromClient = async () => {
    const snapshot = await getDocs(collection(db, "books"));
    return sortBooksByCreatedAt(snapshot.docs.map(mapBookSnapshot));
  };

  const saveBookViaClient = async (payload) => {
    if (isEditing && editId) {
      await updateDoc(doc(db, "books", editId), {
        ...payload,
        updatedAt: serverTimestamp()
      });
      return;
    }

    await addDoc(collection(db, "books"), {
      ...payload,
      createdAt: serverTimestamp()
    });
  };

  const deleteBookViaClient = async (bookId) => {
    await deleteDoc(doc(db, "books", bookId));
  };

  const loadBooks = async () => {
    if (!user || !isAdmin) {
      setBooks([]);
      return;
    }

    setLoadingBooks(true);
    try {
      const response = await authApiRequest("/api/admin/books", {
        method: "GET"
      });
      const booksFromApi = Array.isArray(response?.books)
        ? response.books.map(mapApiBook)
        : [];
      setBooks(sortBooksByCreatedAt(booksFromApi));
    } catch (err) {
      if (shouldUseClientFallback(err)) {
        try {
          const fallbackBooks = await loadBooksFromClient();
          setBooks(fallbackBooks);
          setStatus("Admin API unavailable, catalog loaded directly from Firestore.");
          return;
        } catch (fallbackErr) {
          setStatus(getErrorMessage(fallbackErr) || "Unable to load books.");
          setBooks([]);
          return;
        }
      }

      setStatus(getErrorMessage(err) || "Unable to load books.");
      setBooks([]);
    } finally {
      setLoadingBooks(false);
    }
  };

  useEffect(() => {
    if (!user || !isAdmin) {
      setBooks([]);
      setLoadingBooks(false);
      return;
    }
    loadBooks();
  }, [user, isAdmin]);

  const isEditing = Boolean(editId);
  const readyToUpload = useMemo(() => {
    if (isEditing) {
      return form.title && form.author && form.price;
    }
    return form.title && form.author && form.price && ebookFile;
  }, [form, ebookFile, isEditing]);

  const handleGoogleLogin = async () => {
    setStatus("");
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(auth, provider);
    } catch (err) {
      console.error("Auth error:", err);
      setStatus(`Google sign-in failed: ${err.code || err.message}`);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setForm((prev) => ({ ...prev, [name]: value }));
  };

  const uploadToCloudinary = async (file, onProgress) => {
    const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
    const uploadPreset = import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET;

    if (!cloudName || !uploadPreset) {
      throw new Error("Cloudinary configuration missing in .env");
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("upload_preset", uploadPreset);

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress(percent);
        }
      };

      xhr.onload = () => {
        if (xhr.status === 200) {
          const response = JSON.parse(xhr.responseText);
          resolve(response.secure_url);
        } else {
          try {
            const errorData = JSON.parse(xhr.responseText);
            reject(new Error(`Cloudinary error: ${errorData.error?.message || xhr.statusText}`));
          } catch {
            reject(new Error(`Cloudinary upload failed with status ${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => reject(new Error("Cloudinary upload network error"));
      xhr.send(formData);
    });
  };

  const resetForm = () => {
    setForm(initialForm);
    setEbookFile(null);
    setCoverFile(null);
    setEbookProgress(0);
    setCoverProgress(0);
    setEditId(null);
  };

  const startEdit = (book) => {
    if (!isAdmin) {
      setStatus("Only the configured admin account can edit books.");
      return;
    }
    setEditId(book.id);
    setForm({
      title: book.title || "",
      author: book.author || "",
      price: book.price ?? "",
      category: book.category || "",
      description: book.description || "",
      format: book.format || "PDF / EPUB",
      coverUrl: book.coverUrl || "",
      fileUrl: book.fileUrl || ""
    });
    setEbookFile(null);
    setCoverFile(null);
    setStatus("");
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!isAdmin) {
      setStatus("Only the configured admin account can publish or edit books.");
      return;
    }
    if (!readyToUpload) {
      setStatus("Please complete the required fields.");
      return;
    }

    setSubmitting(true);
    setStatus("");
    setEbookProgress(0);
    setCoverProgress(0);

    try {
      let ebookUrl = form.fileUrl;
      let coverUrl = form.coverUrl;

      if (ebookFile) {
        ebookUrl = await uploadToCloudinary(ebookFile, setEbookProgress);
      }

      if (coverFile) {
        coverUrl = await uploadToCloudinary(coverFile, setCoverProgress);
      }

      const payload = {
        title: form.title,
        author: form.author,
        price: Number(form.price),
        category: form.category || "Featured",
        description: form.description,
        format: form.format,
        coverUrl: coverUrl || "",
        fileUrl: ebookUrl || ""
      };

      let usedFallback = false;

      if (isEditing) {
        try {
          await authApiRequest("/api/admin/books", {
            method: "PATCH",
            body: {
              id: editId,
              ...payload
            }
          });
        } catch (err) {
          if (!shouldUseClientFallback(err)) {
            throw err;
          }
          await saveBookViaClient(payload);
          usedFallback = true;
        }
        setStatus(usedFallback ? "Ebook updated (Firestore fallback)." : "Ebook updated.");
      } else {
        try {
          await authApiRequest("/api/admin/books", {
            method: "POST",
            body: payload
          });
        } catch (err) {
          if (!shouldUseClientFallback(err)) {
            throw err;
          }
          await saveBookViaClient(payload);
          usedFallback = true;
        }
        setStatus(
          usedFallback
            ? "Upload complete (Firestore fallback)."
            : "Upload complete. The ebook is now live."
        );
      }

      resetForm();
      await loadBooks();
    } catch (err) {
      console.error("Submission error:", err);
      setStatus(`Upload failed: ${err.message || "Please try again."}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (book) => {
    if (!isAdmin) {
      setStatus("Only the configured admin account can delete books.");
      return;
    }
    const ok = window.confirm(`Delete "${book.title}"? This cannot be undone.`);
    if (!ok) return;

    setBusyId(book.id);
    try {
      try {
        await authApiRequest("/api/admin/books", {
          method: "DELETE",
          body: { id: book.id }
        });
      } catch (err) {
        if (!shouldUseClientFallback(err)) {
          throw err;
        }
        await deleteBookViaClient(book.id);
        setStatus("Book deleted (Firestore fallback).");
      }
      setBooks((prev) => prev.filter((entry) => entry.id !== book.id));
    } catch (err) {
      setStatus(`Delete failed: ${err?.message || "Please try again."}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page">
      <section className="panel">
        <SectionTitle
          title="Admin Studio"
          subtitle="Manage your digital catalog and upload new ebooks."
        />

        {!user ? (
          <div className="auth-form">
            <p className="muted">
              Sign in with Google to manage your catalog.
            </p>
            <button type="button" className="primary google" onClick={handleGoogleLogin}>
              Continue with Google
            </button>
            {status && <p className="status">{status}</p>}
          </div>
        ) : !isAdmin ? (
          <div className="auth-form center">
            <h2>Access Denied</h2>
            <p className="muted">
              Your account ({user.email}) is not authorized to view the admin panel.
            </p>
            <button type="button" className="ghost" onClick={handleLogout}>
              Sign out and try another account
            </button>
          </div>
        ) : (
          <div className="admin-shell">
            <div className="admin-header">
              <p>Signed in as {user.email}</p>
              <button type="button" className="ghost" onClick={handleLogout}>
                Sign out
              </button>
            </div>
            <form className="admin-form" onSubmit={handleSubmit}>
              <div className="form-head">
                <h3>{isEditing ? "Edit ebook" : "Upload new ebook"}</h3>
                {isEditing && (
                  <button type="button" className="ghost" onClick={resetForm}>
                    Cancel edit
                  </button>
                )}
              </div>
              <div className="grid-2">
                <div>
                  <label>Book Title *</label>
                  <input
                    name="title"
                    value={form.title}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div>
                  <label>Author *</label>
                  <input
                    name="author"
                    value={form.author}
                    onChange={handleChange}
                    required
                  />
                </div>
              </div>
              <div className="grid-3">
                <div>
                  <label>Price (KES) *</label>
                  <input
                    name="price"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.price}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div>
                  <label>Category</label>
                  <input
                    name="category"
                    value={form.category}
                    onChange={handleChange}
                    placeholder="Growth, Fiction, Design..."
                  />
                </div>
                <div>
                  <label>Format</label>
                  <input
                    name="format"
                    value={form.format}
                    onChange={handleChange}
                  />
                </div>
              </div>
              <div>
                <label>Description</label>
                <textarea
                  name="description"
                  value={form.description}
                  onChange={handleChange}
                  rows="4"
                />
              </div>
              <div className="grid-2">
                <div>
                  <label>Cover image (optional)</label>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(event) => setCoverFile(event.target.files?.[0] || null)}
                  />
                  {coverProgress > 0 && (
                    <p className="muted">Cover upload: {coverProgress}%</p>
                  )}
                  {form.coverUrl && !coverFile && (
                    <p className="muted">Current cover will stay.</p>
                  )}
                </div>
                <div>
                  <label>Or cover URL</label>
                  <input
                    name="coverUrl"
                    value={form.coverUrl}
                    onChange={handleChange}
                    placeholder="https://"
                  />
                </div>
              </div>
              <div>
                <label>Ebook file (PDF, EPUB)</label>
                <div className="grid-2 file-split">
                  <div>
                    <span className="muted tiny">Upload file</span>
                    <input
                      type="file"
                      accept=".pdf,.epub"
                      onChange={(event) => setEbookFile(event.target.files?.[0] || null)}
                    />
                  </div>
                  <div>
                    <span className="muted tiny">Or paste URL</span>
                    <input
                      name="fileUrl"
                      value={form.fileUrl}
                      onChange={handleChange}
                      placeholder="https://"
                    />
                  </div>
                </div>
                {ebookProgress > 0 && (
                  <p className="muted">Ebook upload: {ebookProgress}%</p>
                )}
                {isEditing && !ebookFile && form.fileUrl && (
                  <p className="muted">Current ebook source will stay unless changed.</p>
                )}
              </div>
              <button type="submit" className="primary" disabled={!readyToUpload || submitting}>
                {submitting ? "Saving..." : isEditing ? "Update ebook" : "Publish ebook"}
              </button>
              {status && <p className="status">{status}</p>}
            </form>

            <div className="admin-list">
              <div className="form-head">
                <h3>Catalog</h3>
                <span className="muted">
                  {loadingBooks ? "Loading..." : `${books.length} ebooks`}
                </span>
              </div>
              {books.map((book) => (
                <div key={book.id} className="admin-card">
                  <img
                    src={book.coverUrl || "/placeholder-cover.svg"}
                    alt={book.title}
                  />
                  <div>
                    <h4>{book.title}</h4>
                    <p className="muted">{book.author}</p>
                    <p className="muted">
                      {book.category || "Featured"} - {formatCurrency(book.price)}
                    </p>
                  </div>
                  <div className="admin-actions">
                    <button type="button" className="ghost" onClick={() => startEdit(book)}>
                      Edit
                    </button>
                    <button
                      type="button"
                      className="ghost danger"
                      onClick={() => handleDelete(book)}
                      disabled={busyId === book.id}
                    >
                      {busyId === book.id ? "Deleting..." : "Delete"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
