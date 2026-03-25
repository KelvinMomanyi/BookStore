import { parseBody, requireUser } from "../_lib/auth.js";
import {
  XecoflowRequestError,
  buildXecoflowByReceiptUrl,
  getMissingXecoflowConfig,
  requestXecoflowJson
} from "../_lib/xecoflow.js";

const normalizeReceipt = (value) =>
  (value || "").toString().trim().toUpperCase();

const readReceipt = (req) => {
  if (req.method === "GET") {
    return normalizeReceipt(req.query?.receipt);
  }
  const body = parseBody(req);
  return normalizeReceipt(body.receipt || body.code);
};

const sendUpstreamError = (res, err) => {
  if (!(err instanceof XecoflowRequestError)) {
    res.status(500).json({ error: "Unable to fetch receipt details." });
    return;
  }

  if (err.data && typeof err.data === "object") {
    res.status(err.status || 502).json(err.data);
    return;
  }

  res.status(err.status || 502).json({
    success: false,
    error: err.message || "Unable to fetch receipt details."
  });
};

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    res
      .status(405)
      .setHeader("Allow", "GET, POST")
      .json({ error: "Method Not Allowed" });
    return;
  }

  const decoded = await requireUser(req, res);
  if (!decoded) return;

  const receipt = readReceipt(req);
  if (!receipt) {
    res.status(400).json({
      success: false,
      error: "Receipt number is required"
    });
    return;
  }

  const missing = getMissingXecoflowConfig({ requireGateway: true });
  if (missing.length) {
    res.status(500).json({
      success: false,
      error: `Payment lookup is not configured. Missing: ${missing.join(", ")}`
    });
    return;
  }

  const endpoint = buildXecoflowByReceiptUrl(receipt);
  if (!endpoint) {
    res.status(500).json({
      success: false,
      error: "Receipt lookup endpoint is not configured."
    });
    return;
  }

  try {
    const response = await requestXecoflowJson(endpoint, {
      method: "GET",
      headers: {
        "Content-Type": "application/json"
      }
    });

    res.status(200).json(response);
  } catch (err) {
    sendUpstreamError(res, err);
  }
}
