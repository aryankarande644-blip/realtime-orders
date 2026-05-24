// db.js - handles postgres connection and change notifications

const { Pool, Client } = require("pg");

const DB_CONFIG = {
  host: process.env.PGHOST || "localhost",
  port: parseInt(process.env.PGPORT || "5432"),
  database: process.env.PGDATABASE || "realtime_orders",
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
};

async function connectDB() {
  const pool = new Pool({ ...DB_CONFIG, max: 10 });

  // need a separate client for LISTEN - can't use pool here because
  // pool recycles connections and we'd lose our subscription
  const listenerClient = new Client(DB_CONFIG);
  await listenerClient.connect();

  await setupSchema(pool);

  return { pool, listenerClient };
}

async function setupSchema(pool) {
  // create table if it doesn't exist
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id            SERIAL PRIMARY KEY,
      customer_name VARCHAR(255) NOT NULL,
      product_name  VARCHAR(255) NOT NULL,
      status        VARCHAR(20)  NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','shipped','delivered')),
      updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    );
  `);

  // trigger function that fires pg_notify whenever a row changes
  await pool.query(`
    CREATE OR REPLACE FUNCTION notify_orders_change()
    RETURNS TRIGGER AS $$
    DECLARE
      payload JSON;
    BEGIN
      IF (TG_OP = 'DELETE') THEN
        payload = json_build_object(
          'operation', TG_OP,
          'table',     TG_TABLE_NAME,
          'old',       row_to_json(OLD),
          'new',       NULL
        );
      ELSIF (TG_OP = 'INSERT') THEN
        payload = json_build_object(
          'operation', TG_OP,
          'table',     TG_TABLE_NAME,
          'old',       NULL,
          'new',       row_to_json(NEW)
        );
      ELSE
        payload = json_build_object(
          'operation', TG_OP,
          'table',     TG_TABLE_NAME,
          'old',       row_to_json(OLD),
          'new',       row_to_json(NEW)
        );
      END IF;

      PERFORM pg_notify('orders_changes', payload::text);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  await pool.query(`
    DROP TRIGGER IF EXISTS orders_change_trigger ON orders;
    CREATE TRIGGER orders_change_trigger
    AFTER INSERT OR UPDATE OR DELETE ON orders
    FOR EACH ROW EXECUTE FUNCTION notify_orders_change();
  `);
}

async function startListening(listenerClient, onChange) {
  await listenerClient.query("LISTEN orders_changes");

  listenerClient.on("notification", (msg) => {
    if (msg.channel !== "orders_changes") return;
    try {
      const payload = JSON.parse(msg.payload);
      onChange(payload);
    } catch (err) {
      console.error("bad notify payload:", err.message);
    }
  });

  // try to reconnect if something goes wrong
  listenerClient.on("error", (err) => {
    console.error("listener dropped, reconnecting in 5s:", err.message);
    setTimeout(() => {
      listenerClient.connect().then(() => {
        listenerClient.query("LISTEN orders_changes");
        console.log("listener reconnected");
      });
    }, 5000);
  });
}

module.exports = { connectDB, startListening };
