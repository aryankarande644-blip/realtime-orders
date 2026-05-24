# realtime-orders

A real-time order tracking system where the browser updates automatically whenever the database changes — no polling.

## How it works

The core idea is using PostgreSQL's built-in `LISTEN/NOTIFY` feature instead of polling. A trigger fires on every INSERT/UPDATE/DELETE on the `orders` table, which sends a notification to Node.js. Node then pushes that update to all connected browser clients via WebSocket.

```
postgres trigger → pg_notify → node.js → websocket → browser
```

I chose this approach because polling is wasteful — even at 1 req/sec per client, you're making millions of empty DB calls per day for no reason. With LISTEN/NOTIFY, postgres tells you exactly when something changes.

## Stack

- **Node.js** — backend, no framework, just the built-in `http` module
- **PostgreSQL** — database + change notifications via triggers
- **WebSockets** (`ws` library) — push updates to clients
- **Vanilla JS** — frontend, no build step needed

## Project structure

```
├── server/
│   ├── index.js        # entry point
│   ├── db.js           # postgres connection + LISTEN setup
│   ├── ws.js           # websocket server
│   ├── broadcaster.js  # sends events to all connected clients
│   └── httpHandler.js  # REST API + serves index.html
├── client/
│   └── index.html      # browser dashboard
├── scripts/
│   ├── seed.js         # inserts sample data to test the live feed
│   └── cli-client.js   # terminal client (optional)
└── docker-compose.yml  # spin up postgres quickly
```

## Running locally

**Requirements:** Node.js 18+, PostgreSQL 14+

### With Docker

```bash
docker-compose up -d
npm install
npm start
```

### Without Docker (if you already have postgres)

```bash
# create the database first
psql -U postgres -c "CREATE DATABASE realtime_orders;"

export PGHOST=localhost
export PGPORT=5432
export PGDATABASE=realtime_orders
export PGUSER=postgres
export PGPASSWORD=postgres

npm install
npm start
```

Open http://localhost:3000 in your browser. The table and trigger get created automatically on startup.

### See it in action

Run the seed script in a second terminal to insert some orders and simulate status changes:

```bash
npm run seed
```

You should see the browser update in real time without refreshing.

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/orders` | get all orders |
| POST | `/api/orders` | create an order |
| PUT | `/api/orders/:id` | update an order |
| DELETE | `/api/orders/:id` | delete an order |

Example:
```bash
curl -X POST http://localhost:3000/api/orders \
  -H "Content-Type: application/json" \
  -d '{"customer_name":"Aryan","product_name":"Keyboard","status":"pending"}'
```

Every write triggers a WebSocket push to all connected clients instantly.

## WebSocket messages

When a change happens, clients receive:

```json
{
  "type": "ORDER_CHANGE",
  "operation": "UPDATE",
  "table": "orders",
  "data": {
    "new": { "id": 1, "status": "shipped", ... },
    "old": { "id": 1, "status": "pending", ... }
  },
  "timestamp": "2025-05-24T10:00:00.000Z"
}
```

`data.old` is null for INSERT, `data.new` is null for DELETE.

## One thing I'd add with more time

Right now everything runs in a single Node process. If you scale horizontally (multiple instances behind a load balancer), each instance only broadcasts to its own connected clients. The fix is to add Redis pub/sub in the middle — Node publishes to Redis, every instance subscribes and relays to its own clients. The rest of the code stays the same.

## Quick start (for reviewer)

```bash
git clone https://github.com/aryankarande644-blip/realtime-orders.git
cd realtime-orders
npm install
psql -U postgres -c "CREATE DATABASE realtime_orders;"
export PGHOST=localhost PGPORT=5432 PGDATABASE=realtime_orders PGUSER=postgres PGPASSWORD=postgres
npm start
```

Open http://localhost:3000 — the table and trigger are created automatically.

To see live updates run this in a second terminal:
```bash
node scripts/seed.js
```
