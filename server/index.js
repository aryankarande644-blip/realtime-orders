/**
 * Real-Time Orders System — Server Entry Point
 *
 * Architecture:
 *   PostgreSQL LISTEN/NOTIFY  →  Node.js  →  WebSocket  →  Browser clients
 *
 * Why this approach?
 *   - No polling: PostgreSQL notifies us the instant data changes
 *   - WebSockets keep a persistent connection open to each browser tab
 *   - One DB connection handles all change notifications (fan-out in Node)
 *   - Scales horizontally: add a Redis pub/sub layer between Node instances
 */

"use strict";

const http = require("http");
const { setupWebSocketServer } = require("./ws");
const { connectDB, startListening } = require("./db");
const { broadcastChange } = require("./broadcaster");

const PORT = process.env.PORT || 3000;

async function main() {
  console.log("🚀  Starting real-time orders server…");

  // 1. Connect to Postgres (two separate pool clients: one for queries, one for LISTEN)
  const { pool, listenerClient } = await connectDB();
  console.log("✅  PostgreSQL connected");

  // 2. Create the HTTP server (serves the static client page + REST endpoints)
  const server = http.createServer(require("./httpHandler")(pool));

  // 3. Attach WebSocket server on the same HTTP port
  const wss = setupWebSocketServer(server);
  console.log("✅  WebSocket server attached");

  // 4. Start listening for Postgres NOTIFY events
  await startListening(listenerClient, (changeEvent) => {
    // changeEvent = { operation, table, data: { new, old } }
    broadcastChange(wss, changeEvent);
  });
  console.log("✅  Listening for DB changes via NOTIFY");

  // 5. Start accepting connections
  server.listen(PORT, () => {
    console.log(`\n📡  Server ready  →  http://localhost:${PORT}`);
    console.log(`🔌  WebSocket    →  ws://localhost:${PORT}/ws\n`);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
