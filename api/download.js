const ALLOWED_HOST = "res.cloudinary.com";

const pickQueryValue = (value) => {
  if (Array.isArray(value)) return value[0];
  return value;
};

const sanitizeFilename = (value) => {
  const cleaned = (value || "")
    .toString()
    .replace(/[\r\n"]/g, "")
    .replace(/[\\/<>:*?|]/g, "")
    .trim();
  return cleaned || "ebook";
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
    const response = await fetch(target.toString());
    if (!response.ok) {
      res.statusCode = response.status;
      res.end(`Upstream error: ${response.status}`);
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

    const arrayBuffer = await response.arrayBuffer();
    res.statusCode = 200;
    res.end(Buffer.from(arrayBuffer));
  } catch (err) {
    console.error("Download proxy failed", err);
    res.statusCode = 500;
    res.end("Download failed.");
  }
}
