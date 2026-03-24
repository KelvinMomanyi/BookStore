# Isaac books international

A responsive ebook commerce store with Firebase-backed catalog management.

## Setup

1. Install dependencies: `npm install`
2. Create `.env` based on `.env.example` with your Firebase config.
3. Run the app: `npm run dev`

Required payment env keys:
- `VITE_XECO_SOCKET_URL` (or `VITE_API_BASE_URL` + `VITE_XECO_SOCKET_NAMESPACE`)
- `VITE_STK_PROXY_URL` (recommended on Vercel, defaults to `/api/stkpush` in production)
- `VITE_XECO_SERVICE_TYPE` (`payment`)
- `VITE_AUTHOR_WHATSAPP_NUMBER` (author support WhatsApp number for footer chat icon)
- `VITE_ADMIN_EMAIL` (admin account email shown/enforced in UI)
- `VITE_APP_API_BASE` (optional; leave empty for same-origin `/api`)

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
- `userId` (string, Firebase Auth UID)
- `userEmail` (string, normalized email)
- `phoneNumber` (string)
- `items` (array of book snapshots)
- `total` (number)
- `status` (string)
- `createdAt` (timestamp)
- `payment` (object)

## Notes

- Admin sign-in uses Firebase Authentication (Google provider).
- Library access is account-scoped: users only see orders linked to their Firebase account (`userId` / `userEmail`).
- Admin actions are routed through Vercel API and checked against `VITE_ADMIN_EMAIL` / `ADMIN_EMAIL`.
- If Firestore rules are not deployed yet, use the Vercel secured API routes in this repo for account/admin flows.

## Vercel Secured Account/Admin API

These serverless routes are included:
- `POST /api/orders/create`
- `GET /api/orders/account`
- `POST /api/orders/by-id`
- `POST /api/orders/by-transaction`
- `GET|POST|PATCH|DELETE /api/admin/books`

Required Vercel env vars:
- `FIREBASE_PROJECT_ID` (or `VITE_FIREBASE_PROJECT_ID`)
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY`
- `ADMIN_EMAIL` (recommended; falls back to `VITE_ADMIN_EMAIL`)

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
- `XECO_SERVICE_TYPE` (`payment`)
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
