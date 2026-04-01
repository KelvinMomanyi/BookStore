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
import { formatCurrency } from "../utils/format.js";
import { isAdminUser } from "../utils/account.js";
import { isFailedStatus, isPaidStatus, normalizeStatus } from "../utils/orderStatus.js";
import { authApiRequest } from "../utils/secureApi.js";
import "../admin.css";

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

const chartDayFormatter = new Intl.DateTimeFormat("en-KE", {
  month: "short",
  day: "numeric"
});

const toDayKey = (value) => {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

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

const countOrderUnits = (order) =>
  (order?.items || []).reduce(
    (sum, item) => sum + Math.max(1, Math.floor(toNumber(item?.qty, 1))),
    0
  );

const getAdminTabMeta = (activeTab, isEditing) => {
  if (activeTab === "dashboard") {
    return {
      title: "Store Pulse",
      subtitle:
        "A calmer overview of revenue, order flow, and the titles currently driving the store."
    };
  }

  if (activeTab === "catalog") {
    return {
      title: "Catalog Control",
      subtitle:
        "Manage live books, pricing, and edits with a layout that matches the storefront language."
    };
  }

  if (activeTab === "orders") {
    return {
      title: "Order Review",
      subtitle:
        "Track customer purchases, payment references, and orders that still need attention."
    };
  }

  return {
    title: isEditing ? "Edit Ebook" : "Publishing Studio",
    subtitle: isEditing
      ? "Update metadata, replace assets, and save changes without losing context."
      : "Add a new ebook with clearer guidance around files, links, and publishing progress."
  };
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
  const [activeTab, setActiveTab] = useState("dashboard");
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

  const attentionOrders = useMemo(
    () =>
      recentOrders
        .filter((order) => getOrderStatusTone(order) !== "paid")
        .slice(0, 6),
    [recentOrders]
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

  const lastSevenDays = useMemo(() => {
    const base = new Date();
    base.setHours(0, 0, 0, 0);

    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(base);
      date.setDate(base.getDate() - (6 - index));
      return {
        key: toDayKey(date),
        label: chartDayFormatter.format(date),
        orders: 0,
        paidOrders: 0,
        revenue: 0
      };
    });

    const bucket = new Map(days.map((day) => [day.key, day]));

    orders.forEach((order) => {
      const stamp = getOrderTimestamp(order);
      if (!stamp) return;

      const day = bucket.get(toDayKey(stamp));
      if (!day) return;

      day.orders += 1;
      if (isPaymentConfirmedOrder(order)) {
        day.paidOrders += 1;
        day.revenue += toNumber(order?.total, 0);
      }
    });

    const maxRevenue = Math.max(...days.map((day) => day.revenue), 0);
    const maxOrders = Math.max(...days.map((day) => day.orders), 0);

    return {
      days,
      maxRevenue,
      maxOrders,
      totalRevenue: days.reduce((sum, day) => sum + day.revenue, 0),
      totalOrders: days.reduce((sum, day) => sum + day.orders, 0)
    };
  }, [orders]);

  const orderHealthBreakdown = useMemo(() => {
    const entries = [
      { label: "Paid", value: salesStats.paidOrders, tone: "paid" },
      { label: "Pending", value: salesStats.openOrders, tone: "pending" },
      { label: "Review", value: salesStats.reviewOrders, tone: "review" },
      { label: "Failed", value: salesStats.failedOrders, tone: "failed" }
    ];
    const total = entries.reduce((sum, entry) => sum + entry.value, 0) || 1;

    return entries.map((entry) => ({
      ...entry,
      percent: Math.round((entry.value / total) * 100)
    }));
  }, [salesStats]);

  const categoryDistribution = useMemo(() => {
    const counts = new Map();

    books.forEach((book) => {
      const label = (book.category || "Featured").toString().trim() || "Featured";
      counts.set(label, (counts.get(label) || 0) + 1);
    });

    const total = books.length || 1;

    return Array.from(counts.entries())
      .map(([label, count]) => ({
        label,
        count,
        percent: Math.round((count / total) * 100)
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [books]);

  const isEditing = Boolean(editId);
  const activeTabMeta = getAdminTabMeta(activeTab, isEditing);
  const readyToUpload = useMemo(() => {
    return Boolean(
      form.title &&
        form.author &&
        form.price &&
        (ebookFile || form.fileUrl)
    );
  }, [form, ebookFile]);

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
      setStatus("Please complete the required fields and add an ebook file or URL.");
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
      let successMessage = "";

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
        successMessage = usedFallback
          ? "Ebook updated (Firestore fallback)."
          : "Ebook updated.";
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
        successMessage = usedFallback
          ? "Upload complete (Firestore fallback)."
          : "Upload complete. The ebook is now live.";
      }

      resetForm();
      await loadBooks();
      setActiveTab("catalog");
      setStatus(successMessage);
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
      let usedFallback = false;
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
        usedFallback = true;
      }
      setBooks((prev) => prev.filter((entry) => entry.id !== book.id));
      setStatus(
        usedFallback
          ? `"${book.title}" deleted (Firestore fallback).`
          : `"${book.title}" deleted from the catalog.`
      );
    } catch (err) {
      setStatus(`Delete failed: ${err?.message || "Please try again."}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="admin-layout">
      {!user ? (
        <div className="admin-main">
          <div className="admin-auth-shell">
            <div className="admin-auth-copy">
              <p className="kicker">Admin studio</p>
              <h2 className="admin-panel-title">Run the bookstore from a calmer control room.</h2>
              <p className="muted">
                Sign in with Google to manage the catalog, review recent payments, and
                publish new ebooks without leaving the visual language of the storefront.
              </p>
              <div className="admin-auth-points">
                <div>
                  <strong>Catalog control</strong>
                  <span>Keep covers, pricing, and metadata easy to scan.</span>
                </div>
                <div>
                  <strong>Publishing flow</strong>
                  <span>Upload files or use direct URLs with less friction.</span>
                </div>
                <div>
                  <strong>Order visibility</strong>
                  <span>Track revenue and attention-needed orders in one workspace.</span>
                </div>
              </div>
            </div>
            <div className="admin-auth-card">
              <p className="admin-auth-label">Secure access</p>
              <h3>Continue with Google</h3>
              <p className="muted">
                Use the configured administrator account to unlock the workspace.
              </p>
              <button type="button" className="admin-btn admin-btn-google" onClick={handleGoogleLogin}>
                Continue with Google
              </button>
              {status && <p className="status admin-auth-status">{status}</p>}
            </div>
          </div>
        </div>
      ) : !isAdmin ? (
        <div className="admin-main">
          <div className="admin-auth-shell">
            <div className="admin-auth-copy">
              <p className="kicker">Access restricted</p>
              <h2 className="admin-panel-title">This Google account cannot open the admin workspace.</h2>
              <p className="muted">
                Sign out and continue with the configured administrator email to view
                sales, catalog controls, and publishing tools.
              </p>
            </div>
            <div className="admin-auth-card">
              <p className="admin-auth-label">Current account</p>
              <h3>{user.email}</h3>
              <p className="muted">
                Your account is not authorized to view the admin panel.
              </p>
              <button type="button" className="admin-btn-outline" onClick={handleLogout}>
                Sign out and try another account
              </button>
            </div>
          </div>
        </div>
      ) : (
        <>
          <aside className="admin-sidebar">
            <div className="admin-sidebar-header">
              <span>Isaac Books</span>
              <p>Admin studio</p>
            </div>
            <div className="admin-sidebar-nav">
              <button
                type="button"
                className={`admin-nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
                onClick={() => setActiveTab('dashboard')}
              >
                <span>Overview</span>
                <small>Revenue, trends, and store health</small>
              </button>
              <button
                type="button"
                className={`admin-nav-item ${activeTab === 'catalog' ? 'active' : ''}`}
                onClick={() => setActiveTab('catalog')}
              >
                <span>Catalog</span>
                <small>Manage titles, covers, and pricing</small>
              </button>
              <button
                type="button"
                className={`admin-nav-item ${activeTab === 'orders' ? 'active' : ''}`}
                onClick={() => setActiveTab('orders')}
              >
                <span>Orders</span>
                <small>Review payments and customer activity</small>
              </button>
              <button
                type="button"
                className={`admin-nav-item ${activeTab === 'upload' ? 'active' : ''}`}
                onClick={() => { setActiveTab('upload'); resetForm(); }}
              >
                <span>Publishing</span>
                <small>Add a new ebook to the catalog</small>
              </button>
            </div>
            <div className="admin-sidebar-footer">
              <div className="admin-sidebar-stats">
                <div>
                  <span>Books</span>
                  <strong>{books.length}</strong>
                </div>
                <div>
                  <span>Orders</span>
                  <strong>{orders.length}</strong>
                </div>
                <div>
                  <span>Review</span>
                  <strong>{salesStats.reviewOrders + salesStats.openOrders}</strong>
                </div>
              </div>
              <div className="admin-user-info">
                <div className="admin-user-avatar">{user.email.charAt(0).toUpperCase()}</div>
                <div className="admin-user-details">
                  <p>{user.email.split('@')[0]}</p>
                  <span>Administrator</span>
                </div>
              </div>
              <button className="admin-logout-btn" onClick={handleLogout}>Sign out</button>
            </div>
          </aside>

          <main className="admin-main">
            <header className="admin-topbar">
              <div className="admin-topbar-copy">
                <p className="kicker">Bookstore admin</p>
                <h1>{activeTabMeta.title}</h1>
                <p>{activeTabMeta.subtitle}</p>
              </div>
              <div className="admin-topbar-actions">
                {(activeTab === 'dashboard' || activeTab === 'orders') && (
                  <button
                    type="button"
                    className="admin-btn-outline"
                    onClick={handleRefreshDashboard}
                    disabled={loadingOrders}
                  >
                    {loadingOrders ? "Refreshing..." : "Refresh Data"}
                  </button>
                )}
                {activeTab === 'catalog' && (
                  <button
                    type="button"
                    className="admin-btn"
                    onClick={() => { resetForm(); setActiveTab('upload'); }}
                  >
                    Add Ebook
                  </button>
                )}
                {activeTab === 'upload' && isEditing && (
                  <button
                    type="button"
                    className="admin-btn-outline"
                    onClick={() => { resetForm(); setActiveTab('catalog'); }}
                  >
                    Cancel Edit
                  </button>
                )}
              </div>
            </header>

            <div className="admin-content">
              <div className="admin-overview-strip">
                <div className="admin-overview-card">
                  <span>Live books</span>
                  <strong>{books.length}</strong>
                  <p>Titles ready in the catalog.</p>
                </div>
                <div className="admin-overview-card">
                  <span>Confirmed revenue</span>
                  <strong>{formatCurrency(salesStats.revenue)}</strong>
                  <p>{salesStats.paidOrders} paid orders tracked.</p>
                </div>
                <div className="admin-overview-card">
                  <span>Needs attention</span>
                  <strong>{salesStats.reviewOrders + salesStats.openOrders}</strong>
                  <p>Pending or review orders in the queue.</p>
                </div>
              </div>

              {status && <p className="status admin-status-banner">{status}</p>}
              {ordersStatus && <p className="status admin-status-banner admin-status-banner-alt">{ordersStatus}</p>}

              {activeTab === 'dashboard' && (
                <>
                  <div className="admin-stats-row">
                    <div className="admin-stat-box blue">
                      <span className="admin-stat-title">Tracked Orders</span>
                      <strong className="admin-stat-value">{salesStats.trackedOrders}</strong>
                      <span className="admin-stat-desc">All recent orders</span>
                    </div>
                    <div className="admin-stat-box teal">
                      <span className="admin-stat-title">Confirmed Revenue</span>
                      <strong className="admin-stat-value">{formatCurrency(salesStats.revenue)}</strong>
                      <span className="admin-stat-desc">{salesStats.paidOrders} paid orders</span>
                    </div>
                    <div className="admin-stat-box purple">
                      <span className="admin-stat-title">Units Sold</span>
                      <strong className="admin-stat-value">{salesStats.unitsSold}</strong>
                      <span className="admin-stat-desc">{salesStats.customers} customers</span>
                    </div>
                    <div className="admin-stat-box orange">
                      <span className="admin-stat-title">Open Issues</span>
                      <strong className="admin-stat-value">{salesStats.openOrders + salesStats.reviewOrders}</strong>
                      <span className="admin-stat-desc">{salesStats.openOrders} pending, {salesStats.reviewOrders} review</span>
                    </div>
                  </div>

                  <div className="admin-dashboard-grid admin-dashboard-grid-charts">
                    <div className="admin-panel">
                      <div className="admin-panel-header">
                        <span className="admin-panel-title">7 Day Revenue Trend</span>
                        <div className="muted admin-panel-hint">
                          Confirmed earnings and daily order volume
                        </div>
                      </div>
                      <div className="admin-chart-grid">
                        {lastSevenDays.days.map((day) => {
                          const revenueHeight = lastSevenDays.maxRevenue
                            ? Math.max(8, Math.round((day.revenue / lastSevenDays.maxRevenue) * 100))
                            : 0;
                          const ordersHeight = lastSevenDays.maxOrders
                            ? Math.max(8, Math.round((day.orders / lastSevenDays.maxOrders) * 100))
                            : 0;

                          return (
                            <div key={day.key} className="admin-trend-card">
                              <div className="admin-trend-bars">
                                <div className="admin-trend-bar">
                                  <span
                                    className="admin-trend-fill revenue"
                                    style={{ height: revenueHeight ? `${revenueHeight}%` : "0%" }}
                                  />
                                </div>
                                <div className="admin-trend-bar">
                                  <span
                                    className="admin-trend-fill orders"
                                    style={{ height: ordersHeight ? `${ordersHeight}%` : "0%" }}
                                  />
                                </div>
                              </div>
                              <div className="admin-trend-footer">
                                <strong>{day.label}</strong>
                                <span>{formatCurrency(day.revenue)}</span>
                                <span>{day.orders} orders</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="admin-panel">
                      <div className="admin-panel-header">
                        <span className="admin-panel-title">Order Health Breakdown</span>
                        <div className="muted admin-panel-hint">
                          Status mix across all tracked orders
                        </div>
                      </div>
                      <div className="admin-health-panel">
                        <div className="admin-health-stack">
                          {orderHealthBreakdown.map((entry) => (
                            <span
                              key={entry.label}
                              className={`admin-health-segment ${entry.tone}`}
                              style={{ width: `${entry.percent || 0}%` }}
                            />
                          ))}
                        </div>
                        <div className="admin-health-list">
                          {orderHealthBreakdown.map((entry) => (
                            <div key={entry.label} className="admin-health-row">
                              <div className="admin-health-label">
                                <span className={`admin-health-dot ${entry.tone}`} />
                                <strong>{entry.label}</strong>
                              </div>
                              <div className="admin-health-values">
                                <span>{entry.value}</span>
                                <span>{entry.percent}%</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="admin-dashboard-grid admin-dashboard-grid-insights">
                    <div className="admin-panel">
                      <div className="admin-panel-header">
                        <span className="admin-panel-title">Progress Snapshot</span>
                        <div className="muted admin-panel-hint">
                          Core performance metrics in one table
                        </div>
                      </div>
                      <div className="admin-table-container">
                        <table className="admin-table admin-insight-table">
                          <thead>
                            <tr>
                              <th>Metric</th>
                              <th>Current Value</th>
                              <th>Why It Matters</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td>Revenue in the last 7 days</td>
                              <td>{formatCurrency(lastSevenDays.totalRevenue)}</td>
                              <td className="admin-table-note">Shows recent earning momentum from confirmed orders.</td>
                            </tr>
                            <tr>
                              <td>Orders in the last 7 days</td>
                              <td>{lastSevenDays.totalOrders}</td>
                              <td className="admin-table-note">Helps track whether demand is rising or slowing.</td>
                            </tr>
                            <tr>
                              <td>Paid order rate</td>
                              <td>
                                {salesStats.trackedOrders
                                  ? `${Math.round((salesStats.paidOrders / salesStats.trackedOrders) * 100)}%`
                                  : "0%"}
                              </td>
                              <td className="admin-table-note">Compares successful checkouts against all tracked orders.</td>
                            </tr>
                            <tr>
                              <td>Average order value</td>
                              <td>
                                {salesStats.paidOrders
                                  ? formatCurrency(salesStats.revenue / salesStats.paidOrders)
                                  : formatCurrency(0)}
                              </td>
                              <td className="admin-table-note">Useful for understanding the value of each successful purchase.</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="admin-panel">
                      <div className="admin-panel-header">
                        <span className="admin-panel-title">Catalog Mix</span>
                        <div className="muted admin-panel-hint">
                          Most represented categories in the catalog
                        </div>
                      </div>
                      <div className="admin-insight-bands">
                        {categoryDistribution.length === 0 ? (
                          <p className="muted center">Category data will appear once books are added.</p>
                        ) : (
                          categoryDistribution.map((entry) => (
                            <div key={entry.label} className="admin-insight-band">
                              <div className="admin-insight-band-head">
                                <strong>{entry.label}</strong>
                                <span>{entry.count} books</span>
                              </div>
                              <div className="admin-insight-meter">
                                <span
                                  className="admin-insight-fill"
                                  style={{ width: `${entry.percent}%` }}
                                />
                              </div>
                              <div className="muted admin-panel-meta">{entry.percent}% of the catalog</div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="admin-dashboard-grid">
                    <div className="admin-panel">
                      <div className="admin-panel-header">
                        <span className="admin-panel-title">Top Books Sold</span>
                      </div>
                      <div className="admin-table-container">
                        <table className="admin-table">
                          <thead>
                            <tr>
                              <th>Book</th>
                              <th>Units</th>
                              <th>Revenue</th>
                              <th>Current Price</th>
                            </tr>
                          </thead>
                          <tbody>
                            {loadingOrders ? (
                              <tr><td colSpan="4" className="muted center">Loading...</td></tr>
                            ) : topSellingBooks.length === 0 ? (
                              <tr><td colSpan="4" className="muted center">No confirmed purchases yet.</td></tr>
                            ) : (
                              topSellingBooks.map(book => (
                                <tr key={book.key}>
                                  <td>
                                    <strong>{book.title}</strong>
                                    <div className="muted admin-table-subcopy">{book.author}</div>
                                  </td>
                                  <td>{book.units}</td>
                                  <td>{formatCurrency(book.revenue)}</td>
                                  <td>{formatCurrency(book.latestPrice)}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="admin-panel">
                      <div className="admin-panel-header">
                        <span className="admin-panel-title">Attention Queue</span>
                        <div className="muted admin-panel-hint">
                          Orders that may need manual follow-up
                        </div>
                      </div>
                      <div className="admin-activity-stack">
                        {loadingOrders ? (
                          <p className="muted center">Loading activity...</p>
                        ) : attentionOrders.length === 0 ? (
                          <p className="muted center">No pending or review orders right now.</p>
                        ) : (
                          attentionOrders.map(order => {
                            const tone = getOrderStatusTone(order);
                            let badgeClass = 'neutral';
                            if (tone === 'paid') badgeClass = 'success';
                            if (tone === 'failed') badgeClass = 'danger';
                            if (tone === 'review') badgeClass = 'warning';

                            return (
                              <article key={order.id} className="admin-activity-item-card">
                                <div className="admin-activity-item-head">
                                  <div>
                                    <strong>Order {order.id.substring(0, 6)}...</strong>
                                    <p className="muted">{describeOrderTitles(order)}</p>
                                  </div>
                                  <span className={`admin-badge ${badgeClass}`}>{getOrderStatusLabel(order)}</span>
                                </div>
                                <div className="admin-activity-item-meta">
                                  <span>{order.userEmail || order.phoneNumber || "Guest"}</span>
                                  <span>{formatCurrency(order.total)}</span>
                                  <span>{countOrderUnits(order)} units</span>
                                </div>
                              </article>
                            );
                          })
                        )}
                      </div>
                    </div>
                  </div>
                </>
              )}

              {activeTab === 'catalog' && (
                <div className="admin-panel">
                  <div className="admin-panel-header">
                    <span className="admin-panel-title">Ebook Catalog ({books.length})</span>
                    <button className="admin-btn" onClick={() => { resetForm(); setActiveTab('upload'); }}>
                      + Add Ebook
                    </button>
                  </div>
                  <div className="admin-table-container">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Book Title</th>
                          <th>Category</th>
                          <th>Price</th>
                          <th>Downloads</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loadingBooks ? (
                          <tr><td colSpan="5" className="muted center">Loading catalog...</td></tr>
                        ) : books.length === 0 ? (
                          <tr><td colSpan="5" className="muted center">No books available.</td></tr>
                        ) : (
                          books.map(book => (
                            <tr key={book.id}>
                              <td>
                                <div className="admin-table-book">
                                  <img src={book.coverUrl || "/placeholder-cover.svg"} alt={book.title} />
                                  <div className="admin-table-book-info">
                                    <strong>{book.title}</strong>
                                    <span>{book.author}</span>
                                  </div>
                                </div>
                              </td>
                              <td>{book.category || "Featured"}</td>
                              <td>{formatCurrency(book.price)}</td>
                              <td>{book.format || "PDF / EPUB"}</td>
                              <td>
                                <div className="admin-panel-actions">
                                  <button className="admin-btn-outline" onClick={() => { startEdit(book); setActiveTab('upload'); }}>Edit</button>
                                  <button className="admin-btn-danger" onClick={() => handleDelete(book)} disabled={busyId === book.id}>
                                    {busyId === book.id ? "..." : "Delete"}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'orders' && (
                <div className="admin-panel">
                  <div className="admin-panel-header">
                    <span className="admin-panel-title">Tracked Orders</span>
                    <div className="muted admin-panel-meta">
                      Showing {recentOrders.length} of {orders.length} orders
                    </div>
                  </div>
                  <div className="admin-table-container">
                    <table className="admin-table">
                      <thead>
                        <tr>
                          <th>Order ID / Items</th>
                          <th>Customer</th>
                          <th>Status</th>
                          <th>Amount</th>
                          <th>Date</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loadingOrders ? (
                          <tr><td colSpan="5" className="muted center">Loading orders...</td></tr>
                        ) : recentOrders.length === 0 ? (
                          <tr><td colSpan="5" className="muted center">No orders recorded yet.</td></tr>
                        ) : (
                          recentOrders.map(order => {
                            const tone = getOrderStatusTone(order);
                            let badgeClass = 'neutral';
                            if (tone === 'paid') badgeClass = 'success';
                            if (tone === 'failed') badgeClass = 'danger';
                            if (tone === 'review') badgeClass = 'warning';
                            
                            return (
                              <tr key={order.id}>
                                <td>
                                  <strong>Order {order.id.substring(0,6)}...</strong>
                                  <div className="muted admin-order-subcopy">
                                    {describeOrderTitles(order)} ({countOrderUnits(order)} units)
                                  </div>
                                </td>
                                <td>
                                  <div>{order.userEmail || order.phoneNumber || "Guest"}</div>
                                  <div className="muted admin-order-transaction">{order.payment?.transactionId ? `M-Pesa ${order.payment.transactionId}` : ''}</div>
                                </td>
                                <td>
                                  <span className={`admin-badge ${badgeClass}`}>{getOrderStatusLabel(order)}</span>
                                </td>
                                <td>
                                  <strong>{formatCurrency(order.total)}</strong>
                                  {order.payment?.amountMismatch && (
                                     <div className="status error admin-order-warning">
                                       Mismatch (Paid: {order.payment.amount})
                                     </div>
                                  )}
                                </td>
                                <td>{formatOrderDate(order.paidAtMs || order.createdAtMs)}</td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'upload' && (
                <div className="admin-panel admin-form-container">
                  <div className="admin-panel-header">
                    <span className="admin-panel-title">{isEditing ? "Edit Book Details" : "Upload New Ebook"}</span>
                    {isEditing && (
                      <button className="admin-btn-outline" onClick={() => { resetForm(); setActiveTab('catalog'); }}>Cancel Edit</button>
                    )}
                  </div>
                  <form className="admin-content" onSubmit={handleSubmit}>
                    <div className="admin-form-grid">
                      <div className="admin-form-group">
                        <label>Book Title *</label>
                        <input name="title" value={form.title} onChange={handleChange} required />
                      </div>
                      <div className="admin-form-group">
                        <label>Author *</label>
                        <input name="author" value={form.author} onChange={handleChange} required />
                      </div>
                    </div>
                    
                    <div className="admin-form-grid">
                      <div className="admin-form-group">
                        <label>Price (KES) *</label>
                        <input name="price" type="number" min="0" step="0.01" value={form.price} onChange={handleChange} required />
                      </div>
                      <div className="admin-form-group">
                        <label>Category</label>
                        <input name="category" value={form.category} onChange={handleChange} placeholder="Growth, Fiction..." />
                      </div>
                    </div>
                    
                    <div className="admin-form-group">
                      <label>Description</label>
                      <textarea name="description" value={form.description} onChange={handleChange} rows="4" />
                    </div>

                    <div className="admin-form-grid">
                      <div className="admin-form-group">
                        <label>Cover image (Upload optional)</label>
                        <input type="file" accept="image/*" onChange={(event) => setCoverFile(event.target.files?.[0] || null)} />
                        {coverProgress > 0 && <p className="muted admin-upload-progress">Uploading: {coverProgress}%</p>}
                      </div>
                      <div className="admin-form-group">
                        <label>Or Cover URL</label>
                        <input name="coverUrl" value={form.coverUrl} onChange={handleChange} placeholder="https://" />
                      </div>
                    </div>

                    <div className="admin-form-grid">
                      <div className="admin-form-group">
                        <label>Ebook file (PDF/EPUB)</label>
                        <input type="file" accept=".pdf,.epub" onChange={(event) => setEbookFile(event.target.files?.[0] || null)} />
                        {ebookProgress > 0 && <p className="muted admin-upload-progress">Uploading: {ebookProgress}%</p>}
                      </div>
                      <div className="admin-form-group">
                        <label>Or Ebook URL</label>
                        <input name="fileUrl" value={form.fileUrl} onChange={handleChange} placeholder="https://" />
                      </div>
                    </div>

                    <div className="admin-submit-row">
                      <button type="submit" className="admin-btn admin-submit-btn" disabled={!readyToUpload || submitting}>
                        {submitting ? "Saving..." : isEditing ? "Save Changes" : "Publish Ebook"}
                      </button>
                    </div>
                  </form>
                </div>
              )}

            </div>
          </main>
        </>
      )}
    </div>
  );
}
