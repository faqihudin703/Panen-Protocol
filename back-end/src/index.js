/**
 * index.js — Panen Protocol KYC Service
 * Node.js + Express + MySQL
 * Port: 5052
 *
 * Endpoint:
 *   GET  /health
 *   POST /kyc/register    — daftar koperasi/mill
 *   GET  /kyc/status/:wallet
 *   POST /kyc/petani      — submit data petani saat ajukan advance
 */
require("dotenv").config();

const express    = require("express");
const cors       = require("cors");
const helmet     = require("helmet");
const rateLimit  = require("express-rate-limit");
const routes     = require("./routes");

const app  = express();
const PORT = parseInt(process.env.PORT || "5052");

app.set("trust proxy", 1);

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "64kb" }));

// Rate limit: 30 request/menit per IP
app.use(rateLimit({
  windowMs:         60 * 1000,
  max:              30,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: "Terlalu banyak request. Coba lagi dalam 1 menit." },
}));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/", routes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: "Endpoint tidak ditemukan" });
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error("[server] Unhandled error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[kyc] Panen KYC Service running on 0.0.0.0:${PORT}`);
  console.log(`[kyc] DB: ${process.env.DB_NAME}@${process.env.DB_HOST}`);
});
