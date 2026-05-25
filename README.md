# OmniStock: Multi-Warehouse Inventory Hold & Reservation System

OmniStock is a production-grade, highly concurrent inventory reservation and checkout hold system designed for a multi-warehouse eCommerce platform. Engineered with **Next.js 15+ App Router**, **TypeScript**, **Prisma ORM**, and **PostgreSQL**, this application simulates a checkout flow where inventory holds are safely locked during payment processing to prevent overselling.

---

##  Key Architectural Highlights

### 1. Concurrency Control (Atomic Row Locking)
To satisfy the critical requirement of concurrency safety (exactly one buyer secures the last available unit under overlapping checkout attempts while others receive a `409 Conflict`), OmniStock employs **PostgreSQL Row-Level Locking (`SELECT ... FOR UPDATE`)**.
- **The Strategy**: Prisma transactions (`prisma.$transaction`) wrap the booking flow. Inside, a raw database query (`SELECT * FROM "Inventory" ... FOR UPDATE`) is executed to acquire an exclusive lock on the specific `Product-Warehouse` inventory row.
- **Why this choice?** 
  - Standard transaction isolation levels like `Serializable` result in high transaction failures, rollback overloads, and manual retry complexities.
  - Redis distributed locks (e.g., Redlock) add external infrastructure overhead, network overhead, and potential split-brain edge cases.
  - Native database row locking blocks subsequent concurrent requests on the same row in a FIFO queue. The first transaction decreases stock and records the hold; subsequent queued transactions wake up, see the newly adjusted available inventory, and fail safely with a `409 Conflict`.
- **Cross-Database Fallback**: To facilitate hassle-free local development, we implemented a dynamic catch-and-fallback mechanism. If the database provider does not support `FOR UPDATE` row locks (like SQLite), it falls back to standard transactions (which in SQLite automatically locks the database file, guaranteeing correctness in single-writer environments out of the box).

### 2. Multi-Tiered Hold Expiry System
Reservations are created with a default 10-minute validity. If the payment succeeds, the status transitions to `CONFIRMED` and stock is permanently deducted. If they fail or expire, stock must be returned immediately. We use a **dual cleanup design**:
- **Lazy Cleanup**: Every read operation on products or reservations automatically triggers a sweep to locate expired pending holds, mark them as `EXPIRED`, and return their items to the available pool. This guarantees 100% stock display accuracy on catalog views without waiting for schedulers.
- **Cron / Background Worker**: A dedicated lightweight API endpoint (`GET /api/cron/cleanup`) can be registered with **Vercel Crons** or a local server interval, systematically cleaning up abandoned holds in bulk in the background.

### 3. Built-In Request Idempotency
To prevent double charging and duplicate reservations:
- Headers are inspected for `x-idempotency-key`.
- An `IdempotencyRecord` table caches successful reservation and confirmation HTTP statuses and responses in PostgreSQL (retaining them for 24 hours).
- Repeated submissions instantly yield the cached original payload without executing redundant database locks or double-allocations.

---

## 🛠️ Tech Stack

- **Framework**: Next.js 15+ (App Router, Dynamic Route Handlers, Client Components)
- **Language**: TypeScript
- **Database ORM**: Prisma ORM (v7+)
- **Database Engine**: PostgreSQL (Supabase or Neon preferred; SQLite compatible fallback in dev)
- **Styling**: Tailwind CSS v4 & custom glassmorphic panels
- **State Polling**: SWR (Stale-While-Revalidate) for real-time stock sync
- **Validation**: Zod (for API request payload safety)

---

##  Folder Structure

```
├── prisma/
│   ├── schema.prisma       # Database schema (Product, Warehouse, Inventory, Holds)
│   └── seed.ts             # Data seeder for mock catalogs
├── scripts/
│   └── concurrency-test.mjs # CLI concurrency race test runner
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── products/   # GET /api/products (with lazy cleanup)
│   │   │   ├── warehouses/ # GET /api/warehouses
│   │   │   ├── reservations/
│   │   │   │   ├── route.ts # POST (Book Hold) / GET (Holds queue)
│   │   │   │   └── [id]/
│   │   │   │       ├── confirm/ # POST (Confirm Hold & deduct)
│   │   │   │       └── release/ # POST (Release Hold early)
│   │   │   └── seed/       # UI database seed trigger
│   │   ├── globals.css     # Dark mode CSS variables and transitions
│   │   ├── layout.tsx      # Font and SEO configurations
│   │   └── page.tsx        # High-fidelity stateful SWR Dashboard
│   └── lib/
│       ├── db.ts           # Singleton Prisma Client provider
│       └── reservation-service.ts # Core transaction business logic
```

---

##  Local Setup & Installation

### 1. Clone the project and install dependencies
```bash
npm install
```

### 2. Configure Database Environment Variables
Create a `.env` file in the root directory:
```env
# Example for PostgreSQL connection (e.g. Supabase, Neon, or Local)
DATABASE_URL="postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres"
```

*Note: If you wish to test with SQLite locally, modify `prisma/schema.prisma` datasource block provider to `"sqlite"` and define a local file URL in `.env` like `DATABASE_URL="file:./dev.db"`.*

### 3. Generate Database Client & Run Migrations
```bash
npx prisma generate
npx prisma migrate dev --name init
```

### 4. Run Development Server
```bash
npm run dev
```
Open [https://allo-health-assignment-22mia1150.vercel.com](https://allo-health-assignment-22mia1150.vercel.com) to view the real-time holding dashboard!

---

##  Validating Concurrency & Race Conditions

OmniStock supports **two methods** for testing transaction safety under high concurrency:

### Method A: Client-Side Dashboard Simulator (Recommended)
1. In the browser dashboard, find a product with exactly **1 unit available** (e.g., *Aero Office Chair* in the *Midwest Fulfillment Center* after clicking **"Seed Catalog"**).
2. Click the **lightning bolt icon (⚡)** on that product.
3. This fires 3 simultaneous checkouts at the exact same millisecond with unique user identities and keys.
4. A **"Concurrency Battle Arena Logs"** panel will slide into view, demonstrating the database queue processing: exactly **one user wins** (HTTP 201), while concurrent holds are **blocked and rejected** (HTTP 409 Conflict).

### Method B: Automated CLI Script
While the Next.js dev server is running on `http://localhost:3000`, open a separate terminal and run:
```bash
npm run test:concurrency
```
This script will:
1. Automatically reseed the catalog.
2. Resolve the product SKU and warehouse IDs.
3. Fire 5 concurrent requests at the same millisecond.
4. Display a clean terminal results table verifying that exactly **1 buyer wins** and **4 buyers receive a 409 Conflict**.
