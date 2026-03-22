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

/**
 * Extract the public_id, resource_type, and format from a Cloudinary CDN URL.
 *  e.g. https://res.cloudinary.com/dsmz1lxlk/image/upload/v1773392051/km6efxrgnyzoqqn5eujd.pdf
 *       → { resourceType: "image", publicId: "km6efxrgnyzoqqn5eujd", format: "pdf" }
 */
const parseCloudinaryUrl = (urlString) => {
  const url = new URL(urlString);
  const segments = url.pathname.split("/").filter(Boolean);
  // segments: [cloudName, resourceType, deliveryType, ...rest]
  // rest may include version (v12345), transformations, and finally public_id.ext

  const cloudName = process.env.CLOUDINARY_CLOUD_NAME || segments[0];
  const cloudIndex = segments.indexOf(cloudName);
  if (cloudIndex === -1) return null;

  const resourceType = segments[cloudIndex + 1]; // "image", "video", "raw"
  if (!resourceType) return null;

  // Everything after deliveryType (upload/authenticated/private)
  const afterType = segments.slice(cloudIndex + 3);
  if (afterType.length === 0) return null;

  // The last segment is the public_id (possibly with extension)
  const lastSegment = afterType[afterType.length - 1];
  const dotIndex = lastSegment.lastIndexOf(".");
  let publicId, format;
  if (dotIndex > 0) {
    publicId = lastSegment.slice(0, dotIndex);
    format = lastSegment.slice(dotIndex + 1);
  } else {
    publicId = lastSegment;
    format = "";
  }

  // If there are folder segments or version segments before the public_id,
  // include folder path in public_id (skip version segments like v12345)
  const prefixParts = afterType.slice(0, -1).filter(
    (s) => !s.startsWith("v") || !/^v\d+$/.test(s)
  );
  if (prefixParts.length > 0) {
    publicId = [...prefixParts, publicId].join("/");
  }

  return { resourceType, publicId, format };
};

/**
 * Build a Cloudinary download URL using the Download API.
 * This works for all access modes (public, authenticated, private).
 * URL format: https://api.cloudinary.com/v1_1/{cloud}/image/download
 *   ?public_id={id}&format={fmt}&api_key={key}&timestamp={ts}&signature={sig}
 */
const buildCloudinaryDownloadUrl = (publicId, format, resourceType) => {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    console.error("Missing Cloudinary credentials:", {
      hasCloudName: !!cloudName,
      hasApiKey: !!apiKey,
      hasApiSecret: !!apiSecret
    });
    return null;
  }

  const timestamp = Math.floor(Date.now() / 1000);

  // Build the string to sign (parameters in alphabetical order)
  const params = { public_id: publicId, timestamp: String(timestamp) };
  if (format) params.format = format;

  const sortedKeys = Object.keys(params).sort();
  const toSign = sortedKeys.map((k) => `${k}=${params[k]}`).join("&");

  const signature = crypto
    .createHash("sha1")
    .update(toSign + apiSecret)
    .digest("hex");

  const downloadUrl = new URL(
    `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType || "image"}/download`
  );
  downloadUrl.searchParams.set("public_id", publicId);
  if (format) downloadUrl.searchParams.set("format", format);
  downloadUrl.searchParams.set("api_key", apiKey);
  downloadUrl.searchParams.set("timestamp", String(timestamp));
  downloadUrl.searchParams.set("signature", signature);

  return downloadUrl.toString();
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
    // Strategy 1: Use Cloudinary Download API (works for all access modes)
    const parsed = parseCloudinaryUrl(target.toString());
    let response = null;
    let sourceLabel = "";

    if (parsed) {
      const downloadApiUrl = buildCloudinaryDownloadUrl(
        parsed.publicId,
        parsed.format,
        parsed.resourceType
      );

      if (downloadApiUrl) {
        console.log("Trying Cloudinary Download API for:", parsed.publicId);
        const apiResponse = await fetch(downloadApiUrl, { method: req.method });
        if (apiResponse.ok) {
          response = apiResponse;
          sourceLabel = "download-api";
          console.log("Download API succeeded for:", parsed.publicId);
        } else {
          console.error(
            `Download API ${apiResponse.status} for: ${parsed.publicId}`,
            await apiResponse.text().catch(() => "")
          );
        }
      }
    }

    // Strategy 2: Try direct CDN URL as fallback
    if (!response) {
      console.log("Trying direct CDN URL:", target.toString());
      const directResponse = await fetch(target.toString(), { method: req.method });
      if (directResponse.ok) {
        response = directResponse;
        sourceLabel = "direct";
      } else {
        console.error(`Direct CDN ${directResponse.status}: ${target.toString()}`);
      }
    }

    if (!response) {
      res.statusCode = 502;
      res.end(
        "Could not fetch file from Cloudinary. " +
        "Ensure CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET are set correctly."
      );
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
    res.setHeader("X-Download-Source", sourceLabel);
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

    res.statusCode = 200;
    const buffer = Buffer.from(await response.arrayBuffer());
    res.end(buffer);
  } catch (err) {
    console.error("Download proxy failed:", err);
    res.statusCode = 500;
    res.end("Download failed.");
  }
}
