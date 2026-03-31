import crypto from 'crypto';

const normalize = (value) => (value || "").toString().trim();
const withNoTrailingSlash = (value) => normalize(value).replace(/\/+$/g, "");

const TOKEN_REFRESH_BUFFER_MS = 300_000; // Refresh 5 minutes before expiry

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

const getApiBaseUrl = () => {
  const explicitBase = getEnv("XECOFLOW_BASE_URL", "XECO_API_BASE_URL");
  return explicitBase ? withNoTrailingSlash(explicitBase) : "";
};

const getGatewayBaseUrl = () => {
  const explicitGateway = getEnv("XECO_GATEWAY_URL", "XECOFLOW_GATEWAY_URL");
  if (explicitGateway) {
    const cleanGateway = withNoTrailingSlash(explicitGateway);
    return cleanGateway.replace(/\/stkpush$/i, "");
  }

  const apiBase = getApiBaseUrl();
  return apiBase ? `${apiBase}/api/v1/gateway` : "";
};

const getTokenUrl = () => {
  const explicitTokenUrl = getEnv("XECOFLOW_TOKEN_URL", "XECO_TOKEN_URL");
  if (explicitTokenUrl) {
    return withNoTrailingSlash(explicitTokenUrl);
  }

  const apiBase = getApiBaseUrl();
  return apiBase ? `${apiBase}/api/v1/auth/token` : "";
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

export const getMissingXecoflowConfig = ({ requireGateway = false } = {}) => {
  const { missing } = getMissingAuthConfig();
  if (requireGateway && !getGatewayBaseUrl()) {
    missing.push("XECO_GATEWAY_URL or XECOFLOW_BASE_URL");
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

export const requestXecoflowJson = async (url, options = {}) => {
  const targetUrl = normalize(url);
  if (!targetUrl) {
    throw new XecoflowRequestError(500, "XECOFLOW endpoint URL is missing.");
  }

  const { consumerSecret } = getMissingAuthConfig();
  
  const gatewayBase = getGatewayBaseUrl();
  let signaturePath = '';
  if (gatewayBase && targetUrl.startsWith(gatewayBase)) {
    signaturePath = targetUrl.substring(gatewayBase.length);
  } else {
    try {
      signaturePath = new URL(targetUrl).pathname;
    } catch {
      signaturePath = targetUrl;
    }
  }

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID();
  const bodyString = options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : '';

  const signaturePayload = `${signaturePath}${timestamp}${nonce}${bodyString}`;
  let signature = '';
  if (consumerSecret) {
    signature = crypto.createHmac('sha256', consumerSecret)
      .update(signaturePayload)
      .digest('hex');
  }

  const makeRequest = async () => {
    const accessToken = await getAccessToken();
    const headers = normalizeRequestHeaders(options.headers);
    return fetch(targetUrl, {
      ...options,
      headers: {
        ...headers,
        Authorization: `Bearer ${accessToken}`,
        'X-Timestamp': timestamp,
        'X-Nonce': nonce,
        ...(signature ? { 'X-Signature': signature } : {})
      }
    });
  };

  let response = await makeRequest();
  if (response.status === 401 || response.status === 403) {
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

  const gatewayBase = getGatewayBaseUrl();
  return gatewayBase ? `${gatewayBase}/stkpush` : "";
};

export const buildXecoflowByReceiptUrl = (receipt) => {
  const gatewayBase = getGatewayBaseUrl();
  const normalizedReceipt = normalize(receipt);
  if (!gatewayBase || !normalizedReceipt) return "";
  return `${gatewayBase}/transaction/by-receipt/${encodeURIComponent(normalizedReceipt)}`;
};
