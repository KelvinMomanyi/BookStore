import crypto from "node:crypto";

const ALLOWED_HOST = "res.cloudinary.com";

const pickQueryValue = (value) => {
  if (Array.isArray(value)) return value[0];
  return value;
};

const sanitizeFilename = (value) => {
  const cleaned = (value || "")
    .toString()
    .replace(/[\r\n"]/g, "")
    .replace(/[\\/\<\>:*?|]/g, "")
    .trim();
  return cleaned || "ebook";
};

const toBase64Url = (value) =>
  value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");

const buildSignedCloudinaryUrl = (inputUrl, apiSecret) => {
  if (!apiSecret) return inputUrl;

  const url = new URL(inputUrl);
  const segments = url.pathname.split("/").filter(Boolean);

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (cloudName) {
    const cloudIndex = segments.indexOf(cloudName);
    if (cloudIndex === -1 || segments[cloudIndex + 2] == null) {
      return inputUrl;
    }
  }

  const cloudIndex = segments.indexOf(cloudName || segments[0]);
  const resourceType = segments[cloudIndex + 1];
  const deliveryType = segments[cloudIndex + 2];
  const rest = segments.slice(cloudIndex + 3);
  if (!resourceType || !deliveryType || rest.length === 0) {
    return inputUrl;
  }

  const cleanedRest =
    rest[0].startsWith("s--") && rest[0].endsWith("--")
      ? rest.slice(1)
      : rest;
  if (cleanedRest.length === 0) {
    return inputUrl;
  }

  const toSign = cleanedRest.join("/");
  const signatureHash = crypto
    .createHash("sha1")
    .update(`${toSign}${apiSecret}`)
    .digest("base64");
  const signature = toBase64Url(signatureHash).slice(0, 8);

  const signedPath = [
    ...segments.slice(0, cloudIndex + 3),
    `s--${signature}--`,
    ...cleanedRest
  ].join("/");

  url.pathname = `/${signedPath}`;
  return url.toString();
};

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.statusCode = 405;
    res.setHeader("Allow", "GET, HEAD");
    res.end("Method Not Allowed");
    return;
  }

  const urlParam = pickQueryValue(req.query?.url);
  if (!urlParam) {
    res.statusCode = 400;
    res.end("Missing url parameter.");
    return;
  }

  let target;
  try {
    target = new URL(urlParam);
  } catch {
    res.statusCode = 400;
    res.end("Invalid url parameter.");
    return;
  }

  if (target.protocol !== "https:") {
    res.statusCode = 400;
    res.end("Only https URLs are allowed.");
    return;
  }

  if (target.hostname !== ALLOWED_HOST) {
    res.statusCode = 403;
    res.end("Host not allowed.");
    return;
  }

  const pathParts = target.pathname.split("/").filter(Boolean);
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  if (cloudName && pathParts[0] !== cloudName) {
    res.statusCode = 403;
    res.end("Cloud name not allowed.");
    return;
  }

  const filenameParam = pickQueryValue(req.query?.filename);
  const fallbackName = pathParts[pathParts.length - 1] || "ebook";
  const safeName = sanitizeFilename(filenameParam || fallbackName);

  try {
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    const signedUrl = buildSignedCloudinaryUrl(target.toString(), apiSecret);
    const attemptedUrls = [];
    if (signedUrl && signedUrl !== target.toString()) {
      attemptedUrls.push(signedUrl);
    }
    attemptedUrls.push(target.toString());

    let response = null;
    let lastStatus = 0;
    let lastStatusText = "";

    for (const candidateUrl of attemptedUrls) {
      const upstream = await fetch(candidateUrl, { method: req.method });
      if (upstream.ok) {
        response = upstream;
        break;
      }
      lastStatus = upstream.status;
      lastStatusText = upstream.statusText;
      console.error(`Upstream ${upstream.status} for: ${candidateUrl}`);
    }

    if (!response) {
      res.statusCode = lastStatus || 502;
      res.end(`Upstream error: ${lastStatus} ${lastStatusText}. Ensure CLOUDINARY_API_SECRET is set.`);
      return;
    }

    const contentType =
      response.headers.get("content-type") || "application/octet-stream";
    const contentLength = response.headers.get("content-length");

    res.setHeader("Content-Type", contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${safeName}"`
    );
    res.setHeader("Cache-Control", "private, max-age=0, no-store");
    if (contentLength) {
      res.setHeader("Content-Length", contentLength);
    }

    if (req.method === "HEAD") {
      res.statusCode = 200;
      res.end();
      return;
    }

    if (!response.body) {
      res.statusCode = 502;
      res.end("Empty upstream response.");
      return;
    }

    // Use arrayBuffer instead of streaming to avoid Readable.fromWeb compatibility issues
    res.statusCode = 200;
    const buffer = Buffer.from(await response.arrayBuffer());
    res.end(buffer);
  } catch (err) {
    console.error("Download proxy failed:", err);
    res.statusCode = 500;
    res.end("Download failed.");
  }
}
