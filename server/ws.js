/**
 * ws.js — WebSocket server (using the 'ws' library)
 *
 * Design choices:
 *   • We attach ws to the existing HTTP server so both HTTP and WS share port 3000.
 *   • Each client gets a unique ID for clean logging.
 *   • A heartbeat ping/pong every 30 s detects and cleans up dead connections
 *     (e.g., browser tabs that closed without a proper WS close handshake).
 */

"use strict";

const { WebSocketServer, OPEN } = require("ws");
const { randomUUID } = require("crypto");

const HEARTBEAT_INTERVAL_MS = 30_000;

function setupWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  // Heartbeat: mark all clients alive each interval, kill the silent ones
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        console.log(`💀  Client ${ws.id} timed out — terminating`);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_INTERVAL_MS);

  wss.on("close", () => clearInterval(heartbeat));

  wss.on("connection", (ws, req) => {
    ws.id = randomUUID().slice(0, 8);
    ws.isAlive = true;

    console.log(`🔌  Client connected    [${ws.id}]  (${wss.clients.size} total)`);

    // Reset liveness flag on pong
    ws.on("pong", () => { ws.isAlive = true; });

    // Send the client a welcome message with current server time
    safeSend(ws, {
      type: "CONNECTED",
      clientId: ws.id,
      serverTime: new Date().toISOString(),
    });

    ws.on("close", () => {
      console.log(`🔌  Client disconnected [${ws.id}]  (${wss.clients.size} remaining)`);
    });

    ws.on("error", (err) => {
      console.error(`WebSocket error [${ws.id}]:`, err.message);
    });
  });

  return wss;
}

/**
 * Safely serialise and send a message to one WebSocket.
 */
function safeSend(ws, payload) {
  if (ws.readyState !== OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch (err) {
    console.error(`Send error [${ws.id}]:`, err.message);
  }
}

module.exports = { setupWebSocketServer, safeSend };
