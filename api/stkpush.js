import {
  XecoflowRequestError,
  buildXecoflowStkPushUrl,
  getMissingXecoflowConfig,
  requestXecoflowJson
} from "./_lib/xecoflow.js";

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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).setHeader("Allow", "POST").send("Method Not Allowed");
    return;
  }

  const body = parseBody(req);
  const gatewayStkUrl = buildXecoflowStkPushUrl();

  const fallbackShortcode = normalize(process.env.XECO_BUSINESS_SHORTCODE);
  const fallbackCallbackUrl = normalize(process.env.XECO_CALLBACK_URL);

  // Prefer server-side configuration and only fall back to client-provided
  // values when server env vars are unavailable.
  const businessShortcode =
    fallbackShortcode || normalize(body.businessShortcode);
  const callbackUrl = fallbackCallbackUrl || normalize(body.callbackUrl);

  const missing = getMissingXecoflowConfig({ requireGateway: true });
  if (!businessShortcode) {
    missing.push("XECO_BUSINESS_SHORTCODE");
  }
  if (!callbackUrl) {
    missing.push("XECO_CALLBACK_URL");
  }
  if (!gatewayStkUrl) {
    missing.push("XECO_STKPUSH_URL or XECO_GATEWAY_URL");
  }

  if (missing.length) {
    res.status(500).json({
      error: "STK proxy is not configured.",
      missing: [...new Set(missing)]
    });
    return;
  }

  const payload = {
    ...body,
    businessShortcode,
    callbackUrl
  };

  try {
    const data = await requestXecoflowJson(gatewayStkUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    res.status(200).json(data);
  } catch (err) {
    if (err instanceof XecoflowRequestError) {
      if (err.data && typeof err.data === "object") {
        res.status(err.status || 502).json(err.data);
        return;
      }
      res.status(err.status || 502).json({
        error: err.message || "Unable to reach payment gateway"
      });
      return;
    }

    console.error("[STK PROXY] Gateway request failed", {
      message: err?.message
    });
    res.status(502).json({
      error: "Unable to reach payment gateway"
    });
  }
}
