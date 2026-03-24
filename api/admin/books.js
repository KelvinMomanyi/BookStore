import { FieldValue, getAdminDb } from "../_lib/firebaseAdmin.js";
import { parseBody, requireAdmin } from "../_lib/auth.js";

const normalize = (value) => (value || "").toString().trim();
const toNumber = (value, fallback = 0) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
};

const sanitizeBookPayload = (body) => ({
  title: normalize(body?.title),
  author: normalize(body?.author),
  price: Math.max(0, toNumber(body?.price, 0)),
  category: normalize(body?.category) || "Featured",
  description: normalize(body?.description),
  format: normalize(body?.format) || "PDF / EPUB",
  coverUrl: normalize(body?.coverUrl),
  fileUrl: normalize(body?.fileUrl)
});

const validateBookPayload = (payload) => {
  if (!payload.title) return "Book title is required.";
  if (!payload.author) return "Author is required.";
  if (!Number.isFinite(payload.price) || payload.price < 0) {
    return "Price must be a non-negative number.";
  }
  return "";
};

const mapBookDoc = (snap) => {
  const data = snap.data() || {};
  return {
    id: snap.id,
    ...data,
    createdAtMs:
      typeof data?.createdAt?.toMillis === "function"
        ? data.createdAt.toMillis()
        : data?.createdAt?.seconds
          ? data.createdAt.seconds * 1000
          : null
  };
};

export default async function handler(req, res) {
  const adminToken = await requireAdmin(req, res);
  if (!adminToken) return;

  const db = getAdminDb();

  try {
    if (req.method === "GET") {
      const snapshot = await db
        .collection("books")
        .orderBy("createdAt", "desc")
        .limit(300)
        .get();

      const books = snapshot.docs.map(mapBookDoc);
      res.status(200).json({ books });
      return;
    }

    if (req.method === "POST") {
      const body = parseBody(req);
      const payload = sanitizeBookPayload(body);
      const error = validateBookPayload(payload);
      if (error) {
        res.status(400).json({ error });
        return;
      }

      const docRef = await db.collection("books").add({
        ...payload,
        createdAt: FieldValue.serverTimestamp()
      });

      res.status(201).json({ id: docRef.id });
      return;
    }

    if (req.method === "PATCH") {
      const body = parseBody(req);
      const id = normalize(body?.id);
      if (!id) {
        res.status(400).json({ error: "Book id is required." });
        return;
      }

      const payload = sanitizeBookPayload(body);
      const error = validateBookPayload(payload);
      if (error) {
        res.status(400).json({ error });
        return;
      }

      await db.collection("books").doc(id).update({
        ...payload,
        updatedAt: FieldValue.serverTimestamp()
      });

      res.status(200).json({ ok: true });
      return;
    }

    if (req.method === "DELETE") {
      const body = parseBody(req);
      const id = normalize(body?.id || req.query?.id);
      if (!id) {
        res.status(400).json({ error: "Book id is required." });
        return;
      }

      await db.collection("books").doc(id).delete();
      res.status(200).json({ ok: true });
      return;
    }

    res.status(405).setHeader("Allow", "GET, POST, PATCH, DELETE").json({
      error: "Method Not Allowed"
    });
  } catch (err) {
    console.error("[admin/books] failed", err);
    res.status(500).json({ error: "Admin books request failed." });
  }
}

