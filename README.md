# Enterprise POS

A modern, professional Point of Sale & Inventory Management System built for performance on modest hardware.

## Tech Stack

- **Desktop:** Electron + React + TypeScript + Vite
- **Frontend:** React Router, React Query, Zustand, TailwindCSS, shadcn/ui, Framer Motion
- **Backend:** Node.js, Express, Prisma ORM
- **Database:** SQLite (local), PostgreSQL-ready (cloud)

## Features

- Real-time Dashboard with sales analytics and charts
- Full POS screen with barcode search, cart management, and checkout
- Product & inventory management
- Customer management with loyalty points
- Role-based access control
- Dark mode support
- Command palette (Ctrl+K)
- Offline-ready architecture with sync queue
- Keyboard shortcuts (F2 search, F12 checkout)

## Getting Started

### Prerequisites

- Node.js 18+
- npm or pnpm

### Installation

```bash
npm install
```

### Database Setup

```bash
npm run db:push
npm run db:seed
```

### Development

Run the backend and frontend separately:

```bash
# Terminal 1 - API Server
npm run dev:server

# Terminal 2 - Frontend (web)
npm run dev

# Or run Electron app
npm run dev:electron
```

### Demo Login

- **Email:** admin@demostore.com
- **Password:** admin123

## Project Structure

```
├── electron/          # Electron main & preload (context isolation)
├── prisma/            # Database schema & seed
├── server/            # Express API
│   ├── routes/        # API endpoints
│   ├── middleware/    # Auth, error handling
│   └── lib/           # Prisma client
└── src/               # React frontend
    ├── components/    # UI components
    ├── pages/         # Route pages
    ├── stores/        # Zustand state
    ├── hooks/         # Custom hooks
    └── lib/           # Utilities & API client
```

## Performance Optimizations

- Lazy-loaded routes with code splitting
- Debounced search (300ms)
- React Query caching with 30s stale time
- Manual chunk splitting (vendor, charts, UI)
- Skeleton loaders instead of spinners
- Memoized cart calculations

## Switching to PostgreSQL

Update `prisma/schema.prisma`:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Set `DATABASE_URL` in `.env` to your PostgreSQL connection string.

## License

Proprietary - All rights reserved.
