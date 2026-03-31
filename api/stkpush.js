import crypto from "crypto";
import {
  XecoflowRequestError,
  buildXecoflowStkPushUrl,
  getMissingXecoflowConfig,
  requestXecoflowJson
} from "./_lib/xecoflow.js";

const normalize = (value) => (value || "").toString().trim();

const toAmount = (value) => {
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : NaN;
};

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
  const endpoint = buildXecoflowStkPushUrl();
  const missing = getMissingXecoflowConfig({ requirePayments: true });

  if (!endpoint) {
    missing.push("XECOFLOW_BASE_URL");
  }

  if (missing.length) {
    res.status(500).json({
      error: "STK proxy is not configured.",
      missing: [...new Set(missing)]
    });
    return;
  }

  const amount = toAmount(body.amount);
  const phone = normalize(body.phone || body.phoneNumber);
  const reference = normalize(
    body.reference ||
      body.accountReference ||
      body.orderId ||
      body.userId
  );
  const description = normalize(body.description) || "Book Store Purchase";

  if (!Number.isFinite(amount) || amount <= 0) {
    res.status(400).json({
      error: "A valid amount is required."
    });
    return;
  }

  if (!phone) {
    res.status(400).json({
      error: "Phone number is required."
    });
    return;
  }

  if (!reference) {
    res.status(400).json({
      error: "Payment reference is required."
    });
    return;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();
  const idempotencyKey =
    normalize(body.idempotency_key || body.idempotencyKey) || crypto.randomUUID();

  const payload = {
    amount,
    phone,
    reference,
    description,
    nonce,
    timestamp,
    idempotency_key: idempotencyKey
  };

  try {
    const data = await requestXecoflowJson(endpoint, {
      method: "POST",
      body: payload,
      sign: true
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

    console.error("[STK PROXY] Payment request failed", {
      message: err?.message
    });
    res.status(502).json({
      error: "Unable to reach payment gateway"
    });
  }
}
