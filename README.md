# NovaLeaf Books

A responsive ebook commerce store with Firebase-backed catalog management.

## Setup

1. Install dependencies: `npm install`
2. Create `.env` based on `.env.example` with your Firebase config.
3. Run the app: `npm run dev`

Required payment env keys:
- `VITE_XECO_SOCKET_URL` (or `VITE_API_BASE_URL` + `VITE_XECO_SOCKET_NAMESPACE`)
- `VITE_STK_PROXY_URL` (recommended on Vercel, defaults to `/api/stkpush` in production)

If you are not using the STK proxy, also set:
- `VITE_XECO_API_KEY`
- `VITE_XECO_BUSINESS_SHORTCODE`
- `VITE_XECO_GATEWAY_URL` (or `VITE_API_BASE_URL`)
- `VITE_XECO_CALLBACK_URL`

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
   - `CLOUDINARY_CLOUD_NAME` (your cloud name)
   - `CLOUDINARY_API_SECRET` (used to sign delivery URLs)
   - `VITE_DOWNLOAD_PROXY_URL` = `https://<your-vercel-domain>/api/download` (no query string)
3. Redeploy after adding env vars.
4. Make sure your Vercel project uses Node 24 (this repo sets it in `package.json` and `vercel.json`).

## Vercel STK Proxy (Recommended for live checkout)

This repo includes `api/stkpush.js` to avoid browser CORS issues and keep API keys server-side.

Set these env vars in Vercel:
- `XECO_API_KEY`
- `XECO_GATEWAY_URL` (or `XECO_API_BASE_URL`)
- `XECO_BUSINESS_SHORTCODE`
- `XECO_CALLBACK_URL` (for example `https://<your-domain>/api/webhook`)
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `VITE_STK_PROXY_URL` = `https://<your-domain>/api/stkpush` (or leave unset to use default `/api/stkpush` in production)

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
