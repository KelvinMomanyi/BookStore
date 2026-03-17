# NovaLeaf Books

A responsive ebook commerce store with Firebase-backed catalog management.

## Setup

1. Install dependencies: `npm install`
2. Create `.env` based on `.env.example` with your Firebase config.
3. Run the app: `npm run dev`

## Firebase data model

Collection: `books`
Fields:
- `title` (string)
- `author` (string)
- `price` (number)
- `category` (string)
- `description` (string)
- `format` (string)
- `coverUrl` (string)
- `fileUrl` (string)
- `createdAt` (timestamp)
- `updatedAt` (timestamp, optional)

Collection: `orders`
Fields:
- `phoneNumber` (string)
- `items` (array of book snapshots)
- `total` (number)
- `status` (string)
- `createdAt` (timestamp)

## Notes

- Admin sign-in uses Firebase Authentication (Google provider).
- Ebook and cover uploads go to Firebase Storage paths `ebooks/` and `covers/`.
- Downloads are unlocked via the Library page using just the Order ID. Enforce this with Firebase rules if you need hard access control.

## Webhook (Cloud Functions)

This repo includes:
- A webhook endpoint (`xecoWebhook`) that marks orders `paid` when XECO sends a successful callback.
- A download proxy (`downloadEbook`) that forces file download headers for Cloudinary assets.

## Vercel Download Proxy (Recommended if Firebase is limited)

This repo includes a Vercel API route at `api/download.js`.

Setup:
1. Deploy the app to Vercel.
2. In Vercel environment variables, set:
   - `CLOUDINARY_CLOUD_NAME` (e.g. `dsmz1lxlk`)
   - `VITE_DOWNLOAD_PROXY_URL` = `https://<your-vercel-domain>/api/download`
3. Redeploy after adding env vars.

Setup:
1. Install Firebase CLI and initialize functions: `firebase init functions` (select JavaScript).
2. Install dependencies: `cd functions && npm install`.
3. Create `functions/.env` using `functions/.env.example`.
4. Deploy: `firebase deploy --only functions`.

Webhook:
- Set `VITE_XECO_CALLBACK_URL` to your function URL:
  `https://<region>-<project-id>.cloudfunctions.net/xecoWebhook`
- If you set `XECO_WEBHOOK_TOKEN`, append `?token=YOUR_TOKEN` to the callback URL.

Behavior:
- Webhook updates `orders/{orderId}` to `status: paid` when payment succeeds.
- Download proxy expects `VITE_DOWNLOAD_PROXY_URL` in the frontend (set to your function URL).
