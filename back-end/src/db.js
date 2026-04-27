/**
 * db.js — MySQL connection pool
 * Pakai pool agar koneksi tidak habis saat concurrent request
 */
const mysql  = require("mysql2/promise");
require("dotenv").config();

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || "localhost",
  port:       parseInt(process.env.DB_PORT    || "3306"),
  user:               process.env.DB_USER     || "panen_kyc",
  password:           process.env.DB_PASS     || "",
  database:           process.env.DB_NAME     || "panen_kyc",
  waitForConnections: true,
  connectionLimit:    10,
  queueLimit:         0,
  timezone:           "+07:00",  // WIB
  charset:            "utf8mb4",
});

// Test koneksi saat startup
pool.getConnection()
  .then(conn => {
    console.log("[db] MySQL connected");
    conn.release();
  })
  .catch(err => {
    console.error("[db] MySQL connection failed:", err.message);
    process.exit(1);
  });

module.exports = pool;
