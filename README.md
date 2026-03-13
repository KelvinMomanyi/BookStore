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
- `email` (string)
- `items` (array of book snapshots)
- `total` (number)
- `status` (string)
- `createdAt` (timestamp)

## Notes

- Admin sign-in uses Firebase Authentication (Google provider).
- Ebook and cover uploads go to Firebase Storage paths `ebooks/` and `covers/`.
- Downloads are unlocked via the Library page using Order ID + email. Enforce this with Firebase rules if you need hard access control.
