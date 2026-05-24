// entry point - starts the server and wires everything up

const http = require("http");
const { setupWebSocketServer } = require("./ws");
const { connectDB, startListening } = require("./db");
const { broadcastChange } = require("./broadcaster");

const PORT = process.env.PORT || 3000;

async function main() {
  console.log("starting server...");

  const { pool, listenerClient } = await connectDB();
  console.log("postgres connected");

  const server = http.createServer(require("./httpHandler")(pool));

  const wss = setupWebSocketServer(server);

  // listen for postgres NOTIFY events and push to all ws clients
  await startListening(listenerClient, (changeEvent) => {
    broadcastChange(wss, changeEvent);
  });

  server.listen(PORT, () => {
    console.log(`server running on http://localhost:${PORT}`);
    console.log(`websocket on ws://localhost:${PORT}/ws`);
  });
}

main().catch((err) => {
  console.error("startup failed:", err);
  process.exit(1);
});
