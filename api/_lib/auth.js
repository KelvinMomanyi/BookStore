import { getAdminAuth } from "./firebaseAdmin.js";

const normalize = (value) => (value || "").toString().trim().toLowerCase();

export const normalizeEmail = (value) => normalize(value);

export const parseBody = (req) => {
  if (req.body && typeof req.body === "object") {
    return req.body;
  }

  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  return {};
};

const readBearerToken = (req) => {
  const authHeader = req.headers?.authorization || req.headers?.Authorization || "";
  if (typeof authHeader === "string" && authHeader.toLowerCase().startsWith("bearer ")) {
    return authHeader.slice(7).trim();
  }
  return "";
};

export const requireUser = async (req, res) => {
  const token = readBearerToken(req);
  if (!token) {
    res.status(401).json({ error: "Missing auth token." });
    return null;
  }

  try {
    const decoded = await getAdminAuth().verifyIdToken(token);
    return decoded;
  } catch {
    res.status(401).json({ error: "Invalid auth token." });
    return null;
  }
};

export const getConfiguredAdminEmail = () =>
  normalizeEmail(process.env.ADMIN_EMAIL || process.env.VITE_ADMIN_EMAIL || "");

export const isAdminToken = (decodedToken) => {
  const configured = getConfiguredAdminEmail();
  if (!configured) return false;
  return normalizeEmail(decodedToken?.email || "") === configured;
};

export const requireAdmin = async (req, res) => {
  const decoded = await requireUser(req, res);
  if (!decoded) return null;
  if (!isAdminToken(decoded)) {
    res.status(403).json({ error: "Admin access required." });
    return null;
  }
  return decoded;
};

