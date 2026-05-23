# OrderStream — Real-Time Order Updates

A production-quality demonstration of **push-based real-time data propagation** from a PostgreSQL database to browser and CLI clients — with zero polling.

```
PostgreSQL  ──NOTIFY──▶  Node.js  ──WebSocket──▶  Browser / CLI
  trigger                 server                    clients
```

---

## Why This Approach?

### The Problem with Polling

The naive solution — clients asking "anything new?" every N seconds — wastes bandwidth, adds latency proportional to the polling interval, and hammers the database with redundant queries. At 100 clients polling every second you generate 6 million empty queries per day.

### The Solution: PostgreSQL LISTEN/NOTIFY

PostgreSQL ships with a built-in pub/sub primitive:

| Concept    | Description |
|------------|-------------|
| `NOTIFY`   | Sends a text payload (≤8KB) on a named channel, inside a transaction |
| `LISTEN`   | A connection subscribes to a channel and receives an async callback |
| Trigger    | A PL/pgSQL function that fires `NOTIFY` on every INSERT/UPDATE/DELETE |

**The flow in this project:**

1. A row changes in the `orders` table.
2. The `orders_change_trigger` fires `notify_orders_change()`.
3. That function serialises the old and new row to JSON and calls `pg_notify('orders_changes', payload)`.
4. The Node.js **listener client** (a dedicated, non-pooled `pg.Client`) receives the notification instantly via an async event.
5. The Node.js **broadcaster** fans the message out to every connected WebSocket client.
6. The browser re-renders the changed row with a colour flash — no full page refresh needed.

### Why WebSockets (not SSE)?

| | WebSockets | Server-Sent Events |
|---|---|---|
| Direction | Full-duplex | Server → client only |
| Protocol | `ws://` / `wss://` | Standard HTTP |
| Browser support | Universal | Universal (excl. old IE) |
| Reconnect | Manual | Built-in (`EventSource`) |
| Chosen because | We may send client messages later (e.g. ack) | — |

Both work well here. SSE would be slightly simpler; WebSockets give more flexibility.

---

## Architecture Diagram

```
┌─────────────────────────────────────────────┐
│                Node.js Process               │
│                                              │
│  ┌──────────┐      ┌─────────────────────┐  │
│  │ HTTP     │      │  Broadcaster        │  │
│  │ server   │      │  (fan-out to WSS)   │  │
│  └────┬─────┘      └────────┬────────────┘  │
│       │  ws upgrade         │ broadcastChange│
│  ┌────▼─────────────────────▼────────────┐  │
│  │         WebSocket Server (ws lib)     │  │
│  └───────────────────────────────────────┘  │
│                                              │
│  ┌────────────────────────────────────────┐ │
│  │  pg Pool  (REST queries)               │ │
│  └────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────┐ │
│  │  pg.Client (LISTEN — never pooled)    │ │
│  └────────────────────────────────────────┘ │
└──────────────────┬──────────────────────────┘
                   │ TCP
┌──────────────────▼──────────────────────────┐
│             PostgreSQL 16                    │
│                                              │
│  orders table  ──trigger──▶  pg_notify()    │
└─────────────────────────────────────────────┘
```

---

## Project Structure

```
realtime-orders/
├── server/
│   ├── index.js          # Entry point — wires everything together
│   ├── db.js             # PG connection pool + LISTEN/NOTIFY
│   ├── ws.js             # WebSocket server setup + heartbeat
│   ├── broadcaster.js    # Fan-out DB events to WS clients
│   └── httpHandler.js    # REST API + serves client HTML
├── client/
│   └── index.html        # Browser dashboard (vanilla JS, no build step)
├── scripts/
│   ├── cli-client.js     # Terminal WebSocket client
│   └── seed.js           # Populates + updates sample data
├── docker-compose.yml    # Spin up Postgres in one command
├── package.json
└── README.md
```

---

## Quick Start

### 1. Prerequisites

- **Node.js ≥ 18**
- **PostgreSQL 14+**  (or Docker)

### 2. Start PostgreSQL

**With Docker (recommended):**
```bash
docker-compose up -d
```

**Or point to your existing Postgres instance** by setting environment variables:
```bash
export PGHOST=localhost
export PGPORT=5432
export PGDATABASE=realtime_orders
export PGUSER=postgres
export PGPASSWORD=postgres
```

Create the database if it doesn't exist:
```sql
CREATE DATABASE realtime_orders;
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Start the Server

```bash
npm start
```

You'll see:
```
🚀  Starting real-time orders server…
✅  PostgreSQL connected
✅  WebSocket server attached
✅  Listening for DB changes via NOTIFY

📡  Server ready  →  http://localhost:3001
🔌  WebSocket    →  ws://localhost:3001/ws
```

> The server **auto-creates** the `orders` table and installs the trigger on startup.

### 5. Open the Browser Client

Navigate to **http://localhost:3001** in one (or more) browser tabs.

### 6. (Optional) Open the CLI Client

In a second terminal:
```bash
npm run client
```

### 7. Watch Updates Flow

In a third terminal, run the seed script to insert sample orders and simulate status changes:
```bash
npm run seed
```

You'll see the browser dashboard and CLI client update **instantly** without any page refresh.

---

## REST API

| Method | Path | Body | Description |
|--------|------|------|-------------|
| `GET`  | `/api/orders` | — | List all orders |
| `POST` | `/api/orders` | `{ customer_name, product_name, status? }` | Create order |
| `PUT`  | `/api/orders/:id` | `{ customer_name?, product_name?, status? }` | Update order |
| `DELETE` | `/api/orders/:id` | — | Delete order |

**Example — create an order with curl:**
```bash
curl -X POST http://localhost:3001/api/orders \
  -H "Content-Type: application/json" \
  -d '{"customer_name":"Alice","product_name":"Desk Lamp","status":"pending"}'
```

Any mutation immediately triggers a WebSocket push to all connected clients.

---

## WebSocket Message Protocol

### Server → Client

**`CONNECTED`** (sent once on connection):
```json
{ "type": "CONNECTED", "clientId": "a1b2c3d4", "serverTime": "2025-05-24T10:00:00.000Z" }
```

**`ORDER_CHANGE`** (broadcast on every DB change):
```json
{
  "type": "ORDER_CHANGE",
  "operation": "UPDATE",
  "table": "orders",
  "data": {
    "new": { "id": 3, "customer_name": "Sara", "product_name": "Stand", "status": "delivered", "updated_at": "…" },
    "old": { "id": 3, "customer_name": "Sara", "product_name": "Stand", "status": "shipped",   "updated_at": "…" }
  },
  "timestamp": "2025-05-24T10:00:05.123Z"
}
```

`data.old` is `null` for INSERT; `data.new` is `null` for DELETE.

---

## Scalability Considerations

### Current design (single Node instance)

Works well for hundreds of concurrent WebSocket clients. PostgreSQL LISTEN/NOTIFY uses a single persistent connection regardless of the number of clients — the fan-out happens in Node.js memory.

### Scaling horizontally (multiple Node instances)

When you add more Node processes (e.g. behind a load balancer), each instance has its own WebSocket pool and will only receive its own clients' connections. To broadcast to _all_ clients across instances:

```
PostgreSQL NOTIFY
       ↓
  Any Node instance
       ↓  publish
    Redis Pub/Sub  ←→  subscribe  ←  All other Node instances
                                          ↓
                                    their WS clients
```

Add the Redis layer by replacing `broadcaster.js` with a Redis publisher and adding a Redis subscriber in `db.js`. The rest of the code remains unchanged.

### pg_notify payload limit

`pg_notify` payloads are capped at **8,000 bytes**. For rows with large text fields (e.g. `description CLOB`), the trigger should emit only the primary key and let Node fetch the full row with a follow-up `SELECT`. The current implementation is correct for the specified schema.

---

## Design Decisions Summary

| Decision | Choice | Reason |
|---|---|---|
| DB change detection | PostgreSQL triggers + NOTIFY | Zero polling; instant; built-in; transactionally consistent |
| Transport to clients | WebSockets | Persistent, low-latency, full-duplex |
| Backend runtime | Node.js | Event-loop model suits high-concurrency I/O; `pg` and `ws` are battle-tested |
| DB driver | `pg` (node-postgres) | First-class LISTEN/NOTIFY support via async events |
| Listener connection | Dedicated `pg.Client` (not pooled) | Pool recycles connections; LISTEN state would be lost |
| Client | Vanilla JS | No build step; instant load; easy to audit |
| Heartbeat | Ping/pong every 30 s | Detects dead connections that skipped the WS close handshake |

---

## Running Tests (Manual)

1. Open `http://localhost:3001` in **two separate browser windows**.
2. Run `npm run seed` — watch both windows update simultaneously.
3. In the browser form, create a new order — both windows and the CLI client update.
4. Click **advance** to cycle order status — the badge updates with a colour flash.
5. Click **✕** to delete — the row fades out on all clients.
6. Kill and restart the server — clients auto-reconnect and re-fetch state.
