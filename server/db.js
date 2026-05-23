/**
 * db.js — PostgreSQL connection pool + LISTEN/NOTIFY plumbing
 *
 * Key design decisions:
 *   • We use TWO connections from the same pool:
 *       1. `pool`           – regular query pool (used by REST endpoints)
 *       2. `listenerClient` – dedicated LISTEN connection (never released back to pool)
 *     A pooled connection cannot LISTEN reliably because the pool may reuse/recycle it.
 *   • The trigger function calls pg_notify('orders_changes', payload::text) where
 *     payload is a JSON object so the Node side never needs another DB round-trip.
 */

"use strict";

const { Pool, Client } = require("pg");

const DB_CONFIG = {
  host: process.env.PGHOST || "localhost",
  port: parseInt(process.env.PGPORT || "5432"),
  database: process.env.PGDATABASE || "realtime_orders",
  user: process.env.PGUSER || "postgres",
  password: process.env.PGPASSWORD || "postgres",
};

/**
 * Connect to Postgres and bootstrap schema + triggers.
 * Returns { pool, listenerClient }.
 */
async function connectDB() {
  // Pool for normal queries
  const pool = new Pool({ ...DB_CONFIG, max: 10 });

  // Dedicated client for LISTEN (never pooled)
  const listenerClient = new Client(DB_CONFIG);
  await listenerClient.connect();

  // Bootstrap schema and trigger using the pool
  await bootstrapSchema(pool);

  return { pool, listenerClient };
}

/**
 * Create the orders table (if not exists) and install the trigger.
 */
async function bootstrapSchema(pool) {
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

  // The trigger function serialises row data to JSON and calls pg_notify.
  // NEW and OLD are standard PL/pgSQL special variables for the affected rows.
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

      -- pg_notify payload max is 8000 bytes; large blobs need a different strategy
      PERFORM pg_notify('orders_changes', payload::text);
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
  `);

  // Drop + recreate ensures the trigger stays current across deploys
  await pool.query(`
    DROP TRIGGER IF EXISTS orders_change_trigger ON orders;
    CREATE TRIGGER orders_change_trigger
    AFTER INSERT OR UPDATE OR DELETE ON orders
    FOR EACH ROW EXECUTE FUNCTION notify_orders_change();
  `);
}

/**
 * Register a callback on the 'orders_changes' channel.
 * The callback receives a parsed JS object { operation, table, old, new }.
 */
async function startListening(listenerClient, onChange) {
  await listenerClient.query("LISTEN orders_changes");

  listenerClient.on("notification", (msg) => {
    if (msg.channel !== "orders_changes") return;
    try {
      const payload = JSON.parse(msg.payload);
      onChange(payload);
    } catch (err) {
      console.error("Failed to parse NOTIFY payload:", err.message);
    }
  });

  // Reconnect on unexpected disconnect
  listenerClient.on("error", (err) => {
    console.error("Listener client error — reconnecting in 5s:", err.message);
    setTimeout(() => {
      listenerClient.connect().then(() => {
        listenerClient.query("LISTEN orders_changes");
        console.log("♻️  Listener reconnected");
      });
    }, 5000);
  });
}

module.exports = { connectDB, startListening };
