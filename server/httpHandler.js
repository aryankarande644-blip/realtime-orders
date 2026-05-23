/**
 * httpHandler.js — Minimal HTTP layer
 *
 * Routes:
 *   GET  /              → serves the browser client (client/index.html)
 *   GET  /api/orders    → list all orders (newest first)
 *   POST /api/orders    → create a new order
 *   PUT  /api/orders/:id → update order status
 *   DELETE /api/orders/:id → delete an order
 *
 * All mutations trigger the Postgres trigger → NOTIFY → WebSocket broadcast.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const CLIENT_HTML = path.join(__dirname, "../client/index.html");

module.exports = function makeHandler(pool) {
  return async function handler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const pathname = url.pathname;

    // CORS for local development
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    try {
      // ── Static client ──────────────────────────────────────────────────────
      if (pathname === "/" || pathname === "/index.html") {
        const html = fs.readFileSync(CLIENT_HTML, "utf8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(html);
      }

      // ── REST API ───────────────────────────────────────────────────────────

      // GET /api/orders
      if (pathname === "/api/orders" && req.method === "GET") {
        const { rows } = await pool.query(
          "SELECT * FROM orders ORDER BY updated_at DESC"
        );
        return json(res, 200, rows);
      }

      // POST /api/orders
      if (pathname === "/api/orders" && req.method === "POST") {
        const body = await readBody(req);
        const { customer_name, product_name, status = "pending" } = body;

        if (!customer_name || !product_name) {
          return json(res, 400, { error: "customer_name and product_name are required" });
        }

        const { rows } = await pool.query(
          `INSERT INTO orders (customer_name, product_name, status, updated_at)
           VALUES ($1, $2, $3, NOW())
           RETURNING *`,
          [customer_name, product_name, status]
        );
        return json(res, 201, rows[0]);
      }

      // PUT /api/orders/:id
      const putMatch = pathname.match(/^\/api\/orders\/(\d+)$/);
      if (putMatch && req.method === "PUT") {
        const id = parseInt(putMatch[1]);
        const body = await readBody(req);
        const { customer_name, product_name, status } = body;

        const { rows } = await pool.query(
          `UPDATE orders
           SET customer_name = COALESCE($1, customer_name),
               product_name  = COALESCE($2, product_name),
               status        = COALESCE($3, status),
               updated_at    = NOW()
           WHERE id = $4
           RETURNING *`,
          [customer_name || null, product_name || null, status || null, id]
        );

        if (rows.length === 0) return json(res, 404, { error: "Order not found" });
        return json(res, 200, rows[0]);
      }

      // DELETE /api/orders/:id
      const deleteMatch = pathname.match(/^\/api\/orders\/(\d+)$/);
      if (deleteMatch && req.method === "DELETE") {
        const id = parseInt(deleteMatch[1]);
        const { rowCount } = await pool.query("DELETE FROM orders WHERE id = $1", [id]);
        if (rowCount === 0) return json(res, 404, { error: "Order not found" });
        return json(res, 200, { deleted: true, id });
      }

      json(res, 404, { error: "Not found" });
    } catch (err) {
      console.error("HTTP handler error:", err.message);
      json(res, 500, { error: "Internal server error" });
    }
  };
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(data || "{}")); }
      catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}
