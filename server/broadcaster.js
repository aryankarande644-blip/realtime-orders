// broadcaster.js - sends db change events to all connected clients

const { OPEN } = require("ws");
const { safeSend } = require("./ws");

function broadcastChange(wss, changeEvent) {
  const message = {
    type: "ORDER_CHANGE",
    operation: changeEvent.operation,
    table: changeEvent.table,
    data: {
      new: changeEvent.new ?? null,
      old: changeEvent.old ?? null,
    },
    timestamp: new Date().toISOString(),
  };

  let count = 0;
  wss.clients.forEach((ws) => {
    if (ws.readyState === OPEN) {
      safeSend(ws, message);
      count++;
    }
  });

  const row = changeEvent.new ?? changeEvent.old;
  console.log(`[${changeEvent.operation}] order #${row?.id} → sent to ${count} client(s)`);
}

module.exports = { broadcastChange };
