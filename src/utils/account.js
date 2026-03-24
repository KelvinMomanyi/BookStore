export const normalizeEmail = (value) =>
  (value || "").toString().trim().toLowerCase();

export const getConfiguredAdminEmail = () =>
  normalizeEmail(import.meta.env.VITE_ADMIN_EMAIL || "");

export const isAdminEmail = (email) => {
  const configured = getConfiguredAdminEmail();
  return Boolean(configured) && normalizeEmail(email) === configured;
};

export const isAdminUser = (user) => Boolean(user && isAdminEmail(user.email));

export const getOrdersStorageKey = (uid) =>
  `novaleaf_orders_${(uid || "guest").toString().trim()}`;

export const loadStoredOrders = (uid) => {
  if (typeof window === "undefined") return [];
  try {
    const key = getOrdersStorageKey(uid);
    return JSON.parse(window.localStorage.getItem(key) || "[]");
  } catch {
    return [];
  }
};

export const rememberOrder = (order, uid) => {
  const id = typeof order === "string" ? order : order?.id;
  if (!id || typeof window === "undefined") return;

  try {
    const existing = loadStoredOrders(uid);
    const updated = [
      { id },
      ...existing.filter((entry) => {
        const entryId = typeof entry === "string" ? entry : entry?.id;
        return entryId && entryId !== id;
      })
    ].slice(0, 8);
    const key = getOrdersStorageKey(uid);
    window.localStorage.setItem(key, JSON.stringify(updated));
  } catch {
    // ignore local storage write errors
  }
};

