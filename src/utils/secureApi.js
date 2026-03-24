import { auth } from "../firebase.js";

const withNoTrailingSlash = (value) =>
  (value || "").toString().trim().replace(/\/+$/g, "");

const getApiBase = () =>
  withNoTrailingSlash(import.meta.env.VITE_APP_API_BASE || "");

const parseResponse = async (response) => {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
};

export const authApiRequest = async (path, options = {}) => {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error("Please sign in first.");
  }

  const token = await currentUser.getIdToken();
  const urlPath = path.startsWith("/") ? path : `/${path}`;
  const base = getApiBase();
  const url = `${base}${urlPath}`;

  const method = (options.method || "GET").toUpperCase();
  const headers = {
    Authorization: `Bearer ${token}`,
    ...(options.headers || {})
  };

  let body;
  if (options.body !== undefined) {
    headers["Content-Type"] = headers["Content-Type"] || "application/json";
    body = typeof options.body === "string"
      ? options.body
      : JSON.stringify(options.body);
  }

  const response = await fetch(url, {
    method,
    headers,
    body
  });

  const data = await parseResponse(response);
  if (!response.ok) {
    const message =
      data?.error ||
      data?.message ||
      `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return data;
};

