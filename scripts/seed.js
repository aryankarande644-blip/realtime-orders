#!/usr/bin/env node
/**
 * seed.js — Populates the orders table with sample data and then
 *            cycles through status updates so you can watch the live feed.
 *
 * Usage:
 *   node scripts/seed.js
 *
 * Requires: the server to be running (for its DB connection config).
 *           Alternatively set PGHOST / PGDATABASE / PGUSER / PGPASSWORD env vars.
 */

"use strict";

const { Client } = require("pg");

const ORDERS = [
  { customer_name: "Priya Sharma",    product_name: "Mechanical Keyboard",  status: "pending"   },
  { customer_name: "Arjun Mehta",     product_name: "USB-C Hub",            status: "pending"   },
  { customer_name: "Sara Okonkwo",    product_name: "Monitor Stand",        status: "shipped"   },
  { customer_name: "Liu Wei",         product_name: "Noise-Cancel Headset", status: "pending"   },
  { customer_name: "James Oduya",     product_name: "Laptop Sleeve",        status: "delivered" },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function seed() {
  const db = new Client({
    host:     process.env.PGHOST     || "localhost",
    port:     parseInt(process.env.PGPORT || "5432"),
    database: process.env.PGDATABASE || "realtime_orders",
    user:     process.env.PGUSER     || "postgres",
    password: process.env.PGPASSWORD || "postgres",
  });

  await db.connect();
  console.log("✅  Connected to Postgres\n");

  // Clear existing data
  await db.query("TRUNCATE orders RESTART IDENTITY CASCADE");
  console.log("🗑️   Cleared existing orders\n");

  // Insert sample orders
  const ids = [];
  for (const o of ORDERS) {
    const { rows } = await db.query(
      `INSERT INTO orders (customer_name, product_name, status, updated_at)
       VALUES ($1, $2, $3, NOW()) RETURNING id`,
      [o.customer_name, o.product_name, o.status]
    );
    ids.push(rows[0].id);
    console.log(`  ➕  Inserted order #${rows[0].id}  —  ${o.customer_name} / ${o.product_name}`);
    await sleep(400);
  }

  console.log("\n⏳  Simulating status updates in 2 seconds…\n");
  await sleep(2000);

  // Cycle through status updates
  const updates = [
    [ids[0], "shipped"],
    [ids[1], "shipped"],
    [ids[0], "delivered"],
    [ids[3], "shipped"],
    [ids[1], "delivered"],
  ];

  for (const [id, status] of updates) {
    await db.query(
      "UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2",
      [status, id]
    );
    console.log(`  ↻   Updated order #${id} → ${status}`);
    await sleep(600);
  }

  console.log("\n✅  Seed complete — watch the browser/CLI client for live updates!\n");
  await db.end();
}

seed().catch((err) => {
  console.error("Seed failed:", err.message);
  process.exit(1);
});
