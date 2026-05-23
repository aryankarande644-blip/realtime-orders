#!/usr/bin/env node
/**
 * cli-client.js — Terminal client for the real-time orders system
 *
 * Connects to the WebSocket server and prints a colour-coded, live-updating
 * feed of order changes directly in your terminal. Useful for demos and CI.
 *
 * Usage:
 *   node scripts/cli-client.js [ws://localhost:3000/ws]
 */

"use strict";

const { WebSocket } = require("ws");

const WS_URL = process.argv[2] || "ws://localhost:3000/ws";

// ANSI colour helpers
const c = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  green:   "\x1b[32m",
  cyan:    "\x1b[36m",
  yellow:  "\x1b[33m",
  magenta: "\x1b[35m",
  red:     "\x1b[31m",
  grey:    "\x1b[90m",
};

function paint(color, str) { return color + str + c.reset; }

const OP_COLOR = {
  INSERT: c.green,
  UPDATE: c.cyan,
  DELETE: c.red,
};

const STATUS_COLOR = {
  pending:   c.yellow,
  shipped:   c.magenta,
  delivered: c.green,
};

function now() {
  return paint(c.grey, new Date().toLocaleTimeString());
}

console.log(`\n${paint(c.bold, "OrderStream CLI")} — connecting to ${paint(c.cyan, WS_URL)}\n`);

let ws;

function connect() {
  ws = new WebSocket(WS_URL);

  ws.on("open", () => {
    console.log(`${now()}  ${paint(c.green, "●")} Connected\n`);
  });

  ws.on("message", (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === "CONNECTED") {
      console.log(`${now()}  ${paint(c.grey, `client id: ${msg.clientId}`)}`);
      return;
    }

    if (msg.type === "ORDER_CHANGE") {
      const { operation, data } = msg;
      const row = data.new ?? data.old;
      if (!row) return;

      const opColor = OP_COLOR[operation] || c.reset;
      const opTag   = paint(opColor + c.bold, operation.padEnd(6));
      const id      = paint(c.grey, `#${String(row.id).padStart(4, "0")}`);
      const name    = paint(c.bold, row.customer_name);
      const product = row.product_name;
      const status  = row.status
        ? paint(STATUS_COLOR[row.status] || c.reset, row.status)
        : paint(c.red, "—");

      if (operation === "UPDATE" && data.old && data.old.status !== data.new.status) {
        const from = paint(STATUS_COLOR[data.old.status] || c.reset, data.old.status);
        const to   = paint(STATUS_COLOR[data.new.status] || c.reset, data.new.status);
        console.log(`${now()}  ${opTag}  ${id}  ${name}  |  ${product}  |  ${from} → ${to}`);
      } else {
        console.log(`${now()}  ${opTag}  ${id}  ${name}  |  ${product}  |  ${status}`);
      }
    }
  });

  ws.on("close", () => {
    console.log(`\n${now()}  ${paint(c.yellow, "●")} Disconnected — reconnecting in 3s…`);
    setTimeout(connect, 3000);
  });

  ws.on("error", (err) => {
    console.error(`${now()}  ${paint(c.red, "●")} Error: ${err.message}`);
  });
}

connect();

// Graceful shutdown
process.on("SIGINT", () => {
  console.log(`\n\n${paint(c.grey, "Closing…")}\n`);
  ws?.close();
  process.exit(0);
});
