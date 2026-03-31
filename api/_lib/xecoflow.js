import crypto from "crypto";

const normalize = (value) => (value || "").toString().trim();
const withNoTrailingSlash = (value) => normalize(value).replace(/\/+$/g, "");
const TOKEN_REFRESH_BUFFER_MS = 300_000;

let cachedAccessToken = "";
let accessTokenExpiresAt = 0;
let pendingTokenRequest = null;

const readJsonOrText = async (response) => {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  if (contentType.includes("application/json")) {
    try {
      return { type: "json", data: JSON.parse(text) };
    } catch {
      return { type: "text", data: text };
    }
  }

  return { type: "text", data: text };
};

const getEnv = (...keys) => {
  for (const key of keys) {
    const value = normalize(process.env[key]);
    if (value) return value;
  }
  return "";
};

const ensureApiV1Base = (value) => {
  const clean = withNoTrailingSlash(value);
  if (!clean) return "";
  return /\/api\/v1$/i.test(clean) ? clean : `${clean}/api/v1`;
};

const getApiBaseUrl = () => {
  const explicitBase = getEnv("XECOFLOW_BASE_URL", "XECO_API_BASE_URL");
  return explicitBase ? ensureApiV1Base(explicitBase) : "";
};

const getTokenUrl = () => {
  const explicitTokenUrl = getEnv("XECOFLOW_TOKEN_URL", "XECO_TOKEN_URL");
  if (explicitTokenUrl) {
    return withNoTrailingSlash(explicitTokenUrl);
  }

  const apiBase = getApiBaseUrl();
  return apiBase ? `${apiBase}/auth/token` : "";
};

const getPaymentsBaseUrl = () => {
  const apiBase = getApiBaseUrl();
  return apiBase ? `${apiBase}/payments` : "";
};

const hasValidCachedToken = () =>
  Boolean(cachedAccessToken) &&
  Date.now() < accessTokenExpiresAt - TOKEN_REFRESH_BUFFER_MS;

const clearCachedToken = () => {
  cachedAccessToken = "";
  accessTokenExpiresAt = 0;
};

const parseExpirySeconds = (value) => {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return 3600;
};

const getTokenErrorMessage = (status, upstream) => {
  const fallback = `Token request failed (${status})`;

  if (upstream.type === "json" && upstream.data && typeof upstream.data === "object") {
    const data = upstream.data;
    return (
      normalize(data.error_description) ||
      normalize(data.error) ||
      normalize(data.message) ||
      fallback
    );
  }

  if (upstream.type === "text") {
    return normalize(upstream.data) || fallback;
  }

  return fallback;
};

const sortObjectKeys = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const sorted = {};
  Object.keys(value)
    .sort()
    .forEach((key) => {
      sorted[key] = value[key];
    });
  return sorted;
};

const isJsonLikeBody = (value) =>
  Boolean(value) &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  !(value instanceof ArrayBuffer) &&
  !(value instanceof Uint8Array) &&
  !(value instanceof URLSearchParams) &&
  !(value instanceof FormData);

const buildSignedBody = (value) => {
  if (!isJsonLikeBody(value)) {
    throw new XecoflowRequestError(
      500,
      "Signed XECOFLOW requests require a JSON object body."
    );
  }

  const sortedBody = sortObjectKeys(value);
  const bodyString = JSON.stringify(sortedBody);
  return { sortedBody, bodyString };
};

const buildSignature = (bodyString, consumerSecret) =>
  crypto
    .createHmac("sha256", consumerSecret)
    .update(bodyString)
    .digest("base64");

export class XecoflowRequestError extends Error {
  constructor(status, message, data = null) {
    super(message);
    this.name = "XecoflowRequestError";
    this.status = status;
    this.data = data;
  }
}

const getMissingAuthConfig = () => {
  const consumerKey = getEnv("XECOFLOW_CONSUMER_KEY", "XECO_CONSUMER_KEY");
  const consumerSecret = getEnv(
    "XECOFLOW_CONSUMER_SECRET",
    "XECO_CONSUMER_SECRET"
  );
  const tokenUrl = getTokenUrl();

  const missing = [];
  if (!tokenUrl) {
    missing.push("XECO_TOKEN_URL or XECOFLOW_BASE_URL");
  }
  if (!consumerKey) {
    missing.push("XECOFLOW_CONSUMER_KEY");
  }
  if (!consumerSecret) {
    missing.push("XECOFLOW_CONSUMER_SECRET");
  }

  return { missing, tokenUrl, consumerKey, consumerSecret };
};

export const getMissingXecoflowConfig = ({
  requireGateway = false,
  requirePayments = false
} = {}) => {
  const { missing } = getMissingAuthConfig();
  if ((requireGateway || requirePayments) && !getPaymentsBaseUrl()) {
    missing.push("XECOFLOW_BASE_URL");
  }
  return missing;
};

const fetchAccessToken = async () => {
  const { missing, tokenUrl, consumerKey, consumerSecret } = getMissingAuthConfig();
  if (missing.length) {
    throw new XecoflowRequestError(
      500,
      `XECOFLOW auth is not configured. Missing: ${missing.join(", ")}`
    );
  }

  const credentials = Buffer.from(
    `${consumerKey}:${consumerSecret}`
  ).toString("base64");

  const tokenResponse = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json"
    }
  });

  const upstream = await readJsonOrText(tokenResponse);
  if (!tokenResponse.ok) {
    throw new XecoflowRequestError(
      tokenResponse.status,
      getTokenErrorMessage(tokenResponse.status, upstream),
      upstream.type === "json" ? upstream.data : null
    );
  }

  const tokenData =
    upstream.type === "json" && upstream.data && typeof upstream.data === "object"
      ? upstream.data
      : {};

  const accessToken = normalize(tokenData.access_token);
  if (!accessToken) {
    throw new XecoflowRequestError(
      502,
      "Token response did not include access_token."
    );
  }

  const expiresInSeconds = parseExpirySeconds(tokenData.expires_in);
  cachedAccessToken = accessToken;
  accessTokenExpiresAt = Date.now() + expiresInSeconds * 1000;
  return accessToken;
};

const getAccessToken = async () => {
  if (hasValidCachedToken()) {
    return cachedAccessToken;
  }

  if (!pendingTokenRequest) {
    pendingTokenRequest = fetchAccessToken().finally(() => {
      pendingTokenRequest = null;
    });
  }

  return pendingTokenRequest;
};

const normalizeRequestHeaders = (headers = {}) => {
  if (!headers || typeof headers !== "object") return {};
  return { ...headers };
};

const prepareRequestBody = (body, { sign = false, consumerSecret = "" } = {}) => {
  if (body === undefined || body === null) {
    return { body: undefined, headers: {} };
  }

  if (sign) {
    const { sortedBody, bodyString } = buildSignedBody(body);
    const timestamp = normalize(sortedBody.timestamp);
    const nonce = normalize(sortedBody.nonce);
    const idempotencyKey = normalize(
      sortedBody.idempotency_key || sortedBody.idempotencyKey
    );

    if (!timestamp || !nonce || !idempotencyKey) {
      throw new XecoflowRequestError(
        500,
        "Signed XECOFLOW requests require timestamp, nonce, and idempotency_key."
      );
    }

    return {
      body: bodyString,
      headers: {
        "Content-Type": "application/json",
        "X-Timestamp": timestamp,
        "X-Nonce": nonce,
        "X-Idempotency-Key": idempotencyKey,
        "X-Signature": buildSignature(bodyString, consumerSecret)
      }
    };
  }

  if (isJsonLikeBody(body)) {
    return {
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json"
      }
    };
  }

  return { body, headers: {} };
};

export const requestXecoflowJson = async (url, options = {}) => {
  const targetUrl = normalize(url);
  if (!targetUrl) {
    throw new XecoflowRequestError(500, "XECOFLOW endpoint URL is missing.");
  }

  const authenticate = options.authenticate !== false;
  const sign = options.sign === true;

  const makeRequest = async () => {
    const headers = normalizeRequestHeaders(options.headers);
    const { consumerSecret } = getMissingAuthConfig();
    const prepared = prepareRequestBody(options.body, {
      sign,
      consumerSecret
    });

    if (authenticate) {
      const accessToken = await getAccessToken();
      headers.Authorization = `Bearer ${accessToken}`;
    }

    return fetch(targetUrl, {
      ...options,
      headers: {
        ...prepared.headers,
        ...headers
      },
      body: prepared.body
    });
  };

  let response = await makeRequest();
  if (authenticate && (response.status === 401 || response.status === 403)) {
    clearCachedToken();
    response = await makeRequest();
  }

  const upstream = await readJsonOrText(response);
  if (!response.ok) {
    const message =
      upstream.type === "json" && upstream.data && typeof upstream.data === "object"
        ? normalize(upstream.data.error) ||
          normalize(upstream.data.message) ||
          `XECOFLOW request failed (${response.status})`
        : normalize(upstream.data) || `XECOFLOW request failed (${response.status})`;
    throw new XecoflowRequestError(
      response.status,
      message,
      upstream.type === "json" ? upstream.data : null
    );
  }

  if (upstream.type === "json") {
    return upstream.data;
  }

  throw new XecoflowRequestError(
    502,
    "XECOFLOW returned a non-JSON response."
  );
};

export const buildXecoflowStkPushUrl = () => {
  const explicitStkUrl = getEnv("XECOFLOW_STKPUSH_URL", "XECO_STKPUSH_URL");
  if (explicitStkUrl) {
    return withNoTrailingSlash(explicitStkUrl);
  }

  const paymentsBase = getPaymentsBaseUrl();
  return paymentsBase ? `${paymentsBase}/stkpush` : "";
};

export const buildXecoflowStatusUrl = (checkoutId) => {
  const paymentsBase = getPaymentsBaseUrl();
  const normalizedCheckoutId = normalize(checkoutId);
  if (!paymentsBase || !normalizedCheckoutId) return "";
  return `${paymentsBase}/status/${encodeURIComponent(normalizedCheckoutId)}`;
};

export const buildXecoflowByReceiptUrl = (receipt) => {
  const paymentsBase = getPaymentsBaseUrl();
  const normalizedReceipt = normalize(receipt);
  if (!paymentsBase || !normalizedReceipt) return "";
  return `${paymentsBase}/transaction/${encodeURIComponent(normalizedReceipt)}`;
};
