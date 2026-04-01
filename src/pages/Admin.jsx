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
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from "firebase/firestore";
import { auth, db } from "../firebase.js";
import SectionTitle from "../components/SectionTitle.jsx";
import { formatCurrency } from "../utils/format.js";
import { isAdminUser } from "../utils/account.js";
import { isFailedStatus, isPaidStatus, normalizeStatus } from "../utils/orderStatus.js";
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

const dateTimeFormatter = new Intl.DateTimeFormat("en-KE", {
  dateStyle: "medium",
  timeStyle: "short"
});

const toCreatedAtMs = (value) => {
  if (typeof value === "number") return value;
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  return 0;
};

const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const toNullableNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
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

const normalizeOrderItem = (item) => ({
  bookId: (item?.bookId || item?.id || "").toString().trim(),
  title: (item?.title || "").toString().trim(),
  author: (item?.author || "").toString().trim(),
  price: Math.max(0, toNumber(item?.price, 0)),
  qty: Math.max(1, Math.floor(toNumber(item?.qty, 1))),
  coverUrl: (item?.coverUrl || "").toString().trim(),
  fileUrl: (item?.fileUrl || "").toString().trim()
});

const normalizeOrderRecord = (order) => {
  const items = Array.isArray(order?.items)
    ? order.items.map(normalizeOrderItem)
    : [];
  const computedTotal = items.reduce(
    (sum, item) => sum + item.price * item.qty,
    0
  );

  return {
    id: (order?.id || "").toString().trim(),
    userId: (order?.userId || "").toString().trim(),
    userEmail: (order?.userEmail || "").toString().trim(),
    phoneNumber: (order?.phoneNumber || "").toString().trim(),
    items,
    total: Math.max(0, toNumber(order?.total, computedTotal)),
    status: (order?.status || "pending").toString().trim(),
    failureReason: (order?.failureReason || "").toString().trim(),
    createdAtMs: toCreatedAtMs(order?.createdAtMs ?? order?.createdAt),
    linkedAtMs: toCreatedAtMs(order?.linkedAtMs ?? order?.linkedAt),
    paidAtMs: toCreatedAtMs(order?.paidAtMs ?? order?.paidAt),
    payment: {
      provider: (order?.payment?.provider || "").toString().trim(),
      status: (order?.payment?.status || "").toString().trim(),
      gatewayStatus: (order?.payment?.gatewayStatus || "").toString().trim(),
      transactionId: (order?.payment?.transactionId || "").toString().trim(),
      resultCode: order?.payment?.resultCode ?? null,
      resultDesc: (order?.payment?.resultDesc || "").toString().trim(),
      checkoutRequestId:
        (order?.payment?.checkoutRequestId || "").toString().trim(),
      merchantRequestId:
        (order?.payment?.merchantRequestId || "").toString().trim(),
      phoneNumber: (order?.payment?.phoneNumber || "").toString().trim(),
      amount: toNullableNumber(order?.payment?.amount),
      amountMismatch: Boolean(order?.payment?.amountMismatch),
      amountExpected: toNullableNumber(order?.payment?.amountExpected),
      updatedAtMs: toCreatedAtMs(
        order?.payment?.updatedAtMs ?? order?.payment?.updatedAt
      )
    }
  };
};

const mapOrderSnapshot = (snap) =>
  normalizeOrderRecord({
    id: snap.id,
    ...(snap.data() || {})
  });

const mapApiOrder = (order) => normalizeOrderRecord(order || {});

const getOrderTimestamp = (order) =>
  Number(order?.paidAtMs || order?.createdAtMs || order?.linkedAtMs || 0);

const sortOrdersByNewest = (orders) =>
  [...orders].sort((a, b) => getOrderTimestamp(b) - getOrderTimestamp(a));

const isPaymentConfirmedOrder = (order) => {
  const normalizedOrderStatus = normalizeStatus(order?.status);
  const normalizedGatewayStatus = normalizeStatus(order?.payment?.gatewayStatus);
  const resultCode = order?.payment?.resultCode;

  return (
    isPaidStatus(normalizedOrderStatus) ||
    normalizedGatewayStatus === "success" ||
    resultCode === 0 ||
    resultCode === "0"
  );
};

const getOrderStatusTone = (order) => {
  if (order?.payment?.amountMismatch || normalizeStatus(order?.status) === "review") {
    return "review";
  }
  if (isPaymentConfirmedOrder(order)) return "paid";
  if (isFailedStatus(order?.status)) return "failed";
  return "pending";
};

const getOrderStatusLabel = (order) => {
  const tone = getOrderStatusTone(order);
  if (tone === "paid") return "Paid";
  if (tone === "failed") {
    const normalized = normalizeStatus(order?.status);
    if (normalized === "cancelled" || normalized === "canceled") {
      return "Cancelled";
    }
    return "Failed";
  }
  if (tone === "review") return "Review";

  const normalized = normalizeStatus(order?.status);
  return normalized
    ? normalized.replace(/[._-]+/g, " ")
    : "Pending";
};

const formatOrderDate = (value) =>
  value ? dateTimeFormatter.format(value) : "Unknown time";

const describeOrderTitles = (order) => {
  const titles = (order?.items || [])
    .map((item) => item.title)
    .filter(Boolean);

  if (!titles.length) return "No books listed";
  if (titles.length === 1) return titles[0];
  return `${titles[0]} +${titles.length - 1} more`;
};

const getErrorMessage = (err) => (err?.message || "").toString();

const isPermissionDeniedError = (err) => {
  const message = getErrorMessage(err).toLowerCase();
  return (
    message.includes("missing or insufficient permissions") ||
    message.includes("insufficient permissions") ||
    message.includes("permission-denied")
  );
};

const withPermissionHint = (err) => {
  if (!isPermissionDeniedError(err)) return err;
  return new Error(
    "Firestore denied access. Deploy firestore.rules and ensure the signed-in admin email matches the rule, or configure Vercel ADMIN_EMAIL + FIREBASE_* credentials so the admin APIs can access Firestore."
  );
};

const shouldUseClientFallback = (err) => {
  const message = getErrorMessage(err).toLowerCase();
  return (
    message.includes("admin books request failed") ||
    message.includes("admin orders request failed") ||
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
  const [orders, setOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [ordersStatus, setOrdersStatus] = useState("");
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

  const loadOrdersFromClient = async () => {
    const ordersQuery = query(
      collection(db, "orders"),
      orderBy("createdAt", "desc"),
      limit(400)
    );
    const snapshot = await getDocs(ordersQuery);
    return sortOrdersByNewest(snapshot.docs.map(mapOrderSnapshot));
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
          setStatus(
            getErrorMessage(withPermissionHint(fallbackErr)) || "Unable to load books."
          );
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

  const loadOrders = async () => {
    if (!user || !isAdmin) {
      setOrders([]);
      setOrdersStatus("");
      return;
    }

    setLoadingOrders(true);
    try {
      const response = await authApiRequest("/api/admin/orders", {
        method: "GET"
      });
      const ordersFromApi = Array.isArray(response?.orders)
        ? response.orders.map(mapApiOrder)
        : [];
      setOrders(sortOrdersByNewest(ordersFromApi));
      setOrdersStatus("");
    } catch (err) {
      if (shouldUseClientFallback(err)) {
        try {
          const fallbackOrders = await loadOrdersFromClient();
          setOrders(fallbackOrders);
          setOrdersStatus(
            "Admin orders API unavailable, purchase dashboard loaded directly from Firestore."
          );
          return;
        } catch (fallbackErr) {
          setOrdersStatus(
            getErrorMessage(withPermissionHint(fallbackErr)) ||
              "Unable to load purchase data."
          );
          setOrders([]);
          return;
        }
      }

      setOrdersStatus(getErrorMessage(err) || "Unable to load purchase data.");
      setOrders([]);
    } finally {
      setLoadingOrders(false);
    }
  };

  useEffect(() => {
    if (!user || !isAdmin) {
      setBooks([]);
      setOrders([]);
      setLoadingBooks(false);
      setLoadingOrders(false);
      setOrdersStatus("");
      return;
    }
    loadBooks();
    loadOrders();
  }, [user, isAdmin]);

  const confirmedOrders = useMemo(
    () => sortOrdersByNewest(orders.filter(isPaymentConfirmedOrder)),
    [orders]
  );

  const recentOrders = useMemo(
    () => sortOrdersByNewest(orders).slice(0, 40),
    [orders]
  );

  const recentConfirmedOrders = useMemo(
    () => confirmedOrders.slice(0, 6),
    [confirmedOrders]
  );

  const salesStats = useMemo(() => {
    const paidOrders = orders.filter(isPaymentConfirmedOrder);
    const reviewOrders = orders.filter(
      (order) =>
        !isPaymentConfirmedOrder(order) &&
        (order?.payment?.amountMismatch ||
          normalizeStatus(order?.status) === "review")
    );
    const failedOrders = orders.filter(
      (order) =>
        !isPaymentConfirmedOrder(order) &&
        !reviewOrders.some((entry) => entry.id === order.id) &&
        isFailedStatus(order?.status)
    );
    const openOrders = Math.max(
      0,
      orders.length - paidOrders.length - failedOrders.length - reviewOrders.length
    );
    const revenue = paidOrders.reduce(
      (sum, order) => sum + toNumber(order?.total, 0),
      0
    );
    const unitsSold = paidOrders.reduce(
      (sum, order) =>
        sum +
        (order?.items || []).reduce(
          (itemSum, item) => itemSum + Math.max(1, Math.floor(toNumber(item?.qty, 1))),
          0
        ),
      0
    );
    const customerKeys = paidOrders
      .map((order) => order.userEmail || order.phoneNumber || order.userId || "")
      .filter(Boolean);

    return {
      trackedOrders: orders.length,
      paidOrders: paidOrders.length,
      revenue,
      unitsSold,
      customers: new Set(customerKeys).size,
      openOrders,
      failedOrders: failedOrders.length,
      reviewOrders: reviewOrders.length
    };
  }, [orders]);

  const topSellingBooks = useMemo(() => {
    const sales = new Map();

    confirmedOrders.forEach((order) => {
      const seenBooks = new Set();

      (order.items || []).forEach((item) => {
        const key =
          (item.bookId || "").toString().trim() ||
          `${item.title || "Untitled"}::${item.author || ""}`;
        const qty = Math.max(1, Math.floor(toNumber(item.qty, 1)));
        const lineTotal = toNumber(item.price, 0) * qty;
        const existing = sales.get(key) || {
          key,
          title: item.title || "Untitled",
          author: item.author || "Unknown author",
          units: 0,
          revenue: 0,
          orders: 0,
          latestPrice: toNumber(item.price, 0)
        };

        existing.units += qty;
        existing.revenue += lineTotal;
        existing.latestPrice = toNumber(item.price, existing.latestPrice);

        if (!seenBooks.has(key)) {
          existing.orders += 1;
          seenBooks.add(key);
        }

        sales.set(key, existing);
      });
    });

    return Array.from(sales.values())
      .sort((a, b) => b.revenue - a.revenue || b.units - a.units)
      .slice(0, 12);
  }, [confirmedOrders]);

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

  const handleRefreshDashboard = async () => {
    await loadOrders();
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
          try {
            await saveBookViaClient(payload);
          } catch (fallbackErr) {
            throw withPermissionHint(fallbackErr);
          }
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
          try {
            await saveBookViaClient(payload);
          } catch (fallbackErr) {
            throw withPermissionHint(fallbackErr);
          }
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
        try {
          await deleteBookViaClient(book.id);
        } catch (fallbackErr) {
          throw withPermissionHint(fallbackErr);
        }
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
          subtitle="Manage your digital catalog and monitor purchase activity."
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

            <div className="admin-dashboard">
              <div className="form-head">
                <h3>Purchase dashboard</h3>
                <button
                  type="button"
                  className="ghost"
                  onClick={handleRefreshDashboard}
                  disabled={loadingOrders}
                >
                  {loadingOrders ? "Refreshing..." : "Refresh dashboard"}
                </button>
              </div>

              <div className="admin-stats">
                <article className="admin-stat-card">
                  <span>Tracked orders</span>
                  <strong>{salesStats.trackedOrders}</strong>
                  <p className="muted">All recent orders recorded in the storefront.</p>
                </article>
                <article className="admin-stat-card">
                  <span>Confirmed revenue</span>
                  <strong>{formatCurrency(salesStats.revenue)}</strong>
                  <p className="muted">{salesStats.paidOrders} paid orders confirmed.</p>
                </article>
                <article className="admin-stat-card">
                  <span>Units sold</span>
                  <strong>{salesStats.unitsSold}</strong>
                  <p className="muted">{salesStats.customers} customers completed purchases.</p>
                </article>
                <article className="admin-stat-card">
                  <span>Open issues</span>
                  <strong>{salesStats.openOrders + salesStats.reviewOrders}</strong>
                  <p className="muted">
                    {salesStats.openOrders} pending and {salesStats.reviewOrders} review items.
                  </p>
                </article>
              </div>

              {ordersStatus ? <p className="status">{ordersStatus}</p> : null}

              <div className="grid-2 admin-dashboard-grid">
                <section className="admin-panel-card">
                  <div className="form-head">
                    <h3>Top books sold</h3>
                    <span className="muted">
                      {loadingOrders ? "Loading..." : `${topSellingBooks.length} titles`}
                    </span>
                  </div>
                  {loadingOrders ? (
                    <p className="muted">Loading purchase analytics...</p>
                  ) : topSellingBooks.length ? (
                    <div className="admin-sales-table-wrap">
                      <div className="admin-sales-table">
                        <div className="admin-sales-row admin-sales-header">
                          <span>Book</span>
                          <span>Units</span>
                          <span>Revenue</span>
                          <span>Latest price</span>
                        </div>
                        {topSellingBooks.map((book) => (
                          <div key={book.key} className="admin-sales-row">
                            <div className="admin-sales-book">
                              <strong>{book.title}</strong>
                              <span className="muted">
                                {book.author} - {book.orders} orders
                              </span>
                            </div>
                            <span>{book.units}</span>
                            <span>{formatCurrency(book.revenue)}</span>
                            <span>{formatCurrency(book.latestPrice)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="empty">No confirmed purchases yet.</p>
                  )}
                </section>

                <section className="admin-panel-card">
                  <div className="form-head">
                    <h3>Latest confirmed purchases</h3>
                    <span className="muted">
                      {loadingOrders ? "Loading..." : `${confirmedOrders.length} paid orders`}
                    </span>
                  </div>
                  {loadingOrders ? (
                    <p className="muted">Loading recent purchases...</p>
                  ) : recentConfirmedOrders.length ? (
                    <div className="admin-activity-list">
                      {recentConfirmedOrders.map((order) => (
                        <article key={order.id} className="admin-activity-item">
                          <div>
                            <strong>{describeOrderTitles(order)}</strong>
                            <p className="muted">
                              {(order.userEmail || order.phoneNumber || "Unknown buyer")} -{" "}
                              {formatOrderDate(order.paidAtMs || order.createdAtMs)}
                            </p>
                          </div>
                          <span className="price">{formatCurrency(order.total)}</span>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="empty">No paid orders yet.</p>
                  )}
                </section>
              </div>

              <section className="admin-orders">
                <div className="form-head">
                  <h3>Tracked orders</h3>
                  <span className="muted">
                    {loadingOrders
                      ? "Loading..."
                      : `Showing ${recentOrders.length} of ${orders.length} recent orders`}
                  </span>
                </div>
                {loadingOrders ? (
                  <p className="muted">Loading orders...</p>
                ) : recentOrders.length ? (
                  recentOrders.map((order) => (
                    <article key={order.id} className="admin-order-card">
                      <div className="admin-order-head">
                        <div className="admin-order-summary">
                          <div className="admin-order-title-row">
                            <h4>Order {order.id}</h4>
                            <span
                              className={`badge admin-order-badge ${getOrderStatusTone(order)}`}
                            >
                              {getOrderStatusLabel(order)}
                            </span>
                          </div>
                          <div className="admin-order-meta">
                            <span>{formatOrderDate(order.paidAtMs || order.createdAtMs)}</span>
                            {order.userEmail ? <span>{order.userEmail}</span> : null}
                            {order.phoneNumber ? <span>{order.phoneNumber}</span> : null}
                            {order.payment?.transactionId ? (
                              <span>M-Pesa {order.payment.transactionId}</span>
                            ) : null}
                          </div>
                        </div>
                        <div className="admin-order-total">
                          <strong>{formatCurrency(order.total)}</strong>
                          <span className="muted">
                            {(order.items || []).reduce((sum, item) => sum + item.qty, 0)} units
                          </span>
                        </div>
                      </div>

                      {order.payment?.amountMismatch ? (
                        <p className="status error">
                          Payment amount mismatch. Expected{" "}
                          {formatCurrency(order.payment.amountExpected || order.total)}
                          {order.payment.amount !== null
                            ? `, received ${formatCurrency(order.payment.amount)}.`
                            : "."}
                        </p>
                      ) : null}

                      {!order.payment?.amountMismatch && order.failureReason ? (
                        <p className="admin-order-note">{order.failureReason}</p>
                      ) : null}

                      <div className="admin-order-items">
                        {(order.items || []).map((item, index) => (
                          <div
                            key={`${order.id}-${item.bookId || item.title || index}`}
                            className="admin-order-item"
                          >
                            <div>
                              <strong>{item.title || "Untitled"}</strong>
                              <p className="muted">
                                {item.author || "Unknown author"} - Qty {item.qty} -{" "}
                                {formatCurrency(item.price)} each
                              </p>
                            </div>
                            <span className="price">
                              {formatCurrency(item.price * item.qty)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="empty">No orders have been recorded yet.</p>
                )}
              </section>
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
