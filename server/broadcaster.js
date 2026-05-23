/**
 * broadcaster.js — Fan-out DB change events to every connected WebSocket client
 *
 * This is intentionally a thin layer. In a multi-node deployment you would
 * replace (or precede) this with a Redis pub/sub subscriber so all Node
 * instances can relay each other's events.
 *
 * Message envelope sent to clients:
 * {
 *   type:      "ORDER_CHANGE",
 *   operation: "INSERT" | "UPDATE" | "DELETE",
 *   table:     "orders",
 *   data: {
 *     new: { ...row } | null,
 *     old: { ...row } | null
 *   },
 *   timestamp: "<ISO 8601>"
 * }
 */

"use strict";

const { OPEN } = require("ws");
const { safeSend } = require("./ws");

/**
 * @param {WebSocketServer} wss
 * @param {{ operation: string, table: string, new: object|null, old: object|null }} changeEvent
 */
function broadcastChange(wss, changeEvent) {
  const message = {
    type: "ORDER_CHANGE",
    operation: changeEvent.operation,   // INSERT | UPDATE | DELETE
    table: changeEvent.table,
    data: {
      new: changeEvent.new ?? null,
      old: changeEvent.old ?? null,
    },
    timestamp: new Date().toISOString(),
  };

  let delivered = 0;
  wss.clients.forEach((ws) => {
    if (ws.readyState === OPEN) {
      safeSend(ws, message);
      delivered++;
    }
  });

  const row = changeEvent.new ?? changeEvent.old;
  console.log(
    `📢  Broadcast [${changeEvent.operation}] order #${row?.id ?? "?"} → ${delivered} client(s)`
  );
}

module.exports = { broadcastChange };
