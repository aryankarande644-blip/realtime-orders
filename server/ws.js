// ws.js - sets up the websocket server

const { WebSocketServer, OPEN } = require("ws");
const { randomUUID } = require("crypto");

const HEARTBEAT_MS = 30_000;

function setupWebSocketServer(httpServer) {
  const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  // ping clients every 30s and kill ones that don't respond
  const heartbeat = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (!ws.isAlive) {
        console.log(`client ${ws.id} timed out`);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_MS);

  wss.on("close", () => clearInterval(heartbeat));

  wss.on("connection", (ws) => {
    ws.id = randomUUID().slice(0, 8);
    ws.isAlive = true;

    console.log(`client connected [${ws.id}] (${wss.clients.size} total)`);

    ws.on("pong", () => { ws.isAlive = true; });

    // tell the client its id and when it connected
    safeSend(ws, {
      type: "CONNECTED",
      clientId: ws.id,
      serverTime: new Date().toISOString(),
    });

    ws.on("close", () => {
      console.log(`client disconnected [${ws.id}] (${wss.clients.size} remaining)`);
    });

    ws.on("error", (err) => {
      console.error(`ws error [${ws.id}]:`, err.message);
    });
  });

  return wss;
}

function safeSend(ws, payload) {
  if (ws.readyState !== OPEN) return;
  try {
    ws.send(JSON.stringify(payload));
  } catch (err) {
    console.error(`send failed [${ws.id}]:`, err.message);
  }
}

module.exports = { setupWebSocketServer, safeSend };
