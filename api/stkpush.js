const normalize = (value) => (value || "").toString().trim();

const parseBody = (req) => {
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

const withNoTrailingSlash = (value) => normalize(value).replace(/\/+$/g, "");

const buildGatewayStkUrl = () => {
  const explicitGateway =
    normalize(process.env.XECO_GATEWAY_URL) ||
    normalize(process.env.VITE_XECO_GATEWAY_URL);
  if (explicitGateway) {
    return `${withNoTrailingSlash(explicitGateway)}/stkpush`;
  }

  const apiBase =
    normalize(process.env.XECO_API_BASE_URL) ||
    normalize(process.env.VITE_API_BASE_URL);
  if (apiBase) {
    return `${withNoTrailingSlash(apiBase)}/api/v1/gateway/stkpush`;
  }

  return "";
};

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).setHeader("Allow", "POST").send("Method Not Allowed");
    return;
  }

  const body = parseBody(req);
  const gatewayStkUrl = buildGatewayStkUrl();
  const apiKey =
    normalize(process.env.XECO_API_KEY) ||
    normalize(process.env.VITE_XECO_API_KEY);
  const fallbackShortcode =
    normalize(process.env.XECO_BUSINESS_SHORTCODE) ||
    normalize(process.env.VITE_XECO_BUSINESS_SHORTCODE);
  const fallbackCallbackUrl =
    normalize(process.env.XECO_CALLBACK_URL) ||
    normalize(process.env.VITE_XECO_CALLBACK_URL);

  const businessShortcode =
    normalize(body.businessShortcode) || fallbackShortcode;
  const callbackUrl = normalize(body.callbackUrl) || fallbackCallbackUrl;

  const missing = [];
  if (!gatewayStkUrl) {
    missing.push("XECO_GATEWAY_URL or XECO_API_BASE_URL");
  }
  if (!apiKey) {
    missing.push("XECO_API_KEY");
  }
  if (!businessShortcode) {
    missing.push("XECO_BUSINESS_SHORTCODE");
  }
  if (!callbackUrl) {
    missing.push("XECO_CALLBACK_URL");
  }

  if (missing.length) {
    res.status(500).json({
      error: "STK proxy is not configured.",
      missing
    });
    return;
  }

  const payload = {
    ...body,
    businessShortcode,
    callbackUrl
  };

  try {
    const gatewayResponse = await fetch(gatewayStkUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey
      },
      body: JSON.stringify(payload)
    });

    const upstream = await readJsonOrText(gatewayResponse);

    if (upstream.type === "json") {
      res.status(gatewayResponse.status).json(upstream.data);
      return;
    }

    res
      .status(gatewayResponse.status)
      .send(
        upstream.data || `Gateway request failed (${gatewayResponse.status})`
      );
  } catch (err) {
    console.error("[STK PROXY] Gateway request failed", err);
    res.status(502).json({
      error: "Unable to reach payment gateway"
    });
  }
}
