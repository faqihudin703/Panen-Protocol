/**
 * routes.js — KYC API routes
 *
 * POST /kyc/register          — daftarkan koperasi atau mill
 * GET  /kyc/status/:wallet    — cek status registrasi
 * POST /kyc/petani            — submit data petani saat ajukan advance
 * GET  /health                — health check
 */
const express = require("express");
const pool    = require("./db");
const {
  validate, registerRules, petaniRules, walletParam,
} = require("./validators");

const router = express.Router();

// ── Health check ──────────────────────────────────────────────────────────────
router.get("/health", async (req, res) => {
  try {
    await pool.execute("SELECT 1");
    res.json({ status: "ok", db: "connected", ts: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: "error", db: "disconnected" });
  }
});

// ── POST /kyc/register ────────────────────────────────────────────────────────
router.post("/kyc/register",
  registerRules, validate,
  async (req, res) => {
    const {
      entity_type, name, reg_number, address,
      pic_name, pic_phone, wallet_pubkey,
    } = req.body;

    try {
      const [result] = await pool.execute(
        `INSERT INTO entities
           (entity_type, name, reg_number, address,
            pic_name, pic_phone, wallet_pubkey)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [entity_type, name.trim(), reg_number.trim(),
         address.trim(), pic_name.trim(),
         pic_phone.trim(), wallet_pubkey.trim()]
      );

      console.log(`[kyc] register: ${entity_type} "${name}" wallet=${wallet_pubkey.slice(0,8)}…`);

      return res.status(201).json({
        id:           result.insertId,
        entity_type,
        name:         name.trim(),
        wallet_pubkey: wallet_pubkey.trim(),
        registered_at: new Date().toISOString(),
        message:      "Registrasi KYC berhasil. Anda dapat langsung menggunakan protokol.",
      });

    } catch (err) {
      if (err.code === "ER_DUP_ENTRY") {
        if (err.message.includes("wallet_pubkey")) {
          return res.status(409).json({
            error: "Wallet ini sudah terdaftar",
            field: "wallet_pubkey",
          });
        }
        if (err.message.includes("reg_number")) {
          return res.status(409).json({
            error: "Nomor registrasi sudah digunakan",
            field: "reg_number",
          });
        }
      }
      console.error("[kyc] register error:", err.message);
      return res.status(500).json({ error: "Terjadi kesalahan server" });
    }
  }
);

// ── GET /kyc/status/:wallet ───────────────────────────────────────────────────
router.get("/kyc/status/:wallet",
  walletParam, validate,
  async (req, res) => {
    const { wallet } = req.params;
    try {
      const [rows] = await pool.execute(
        `SELECT id, entity_type, name, created_at
         FROM entities WHERE wallet_pubkey = ? LIMIT 1`,
        [wallet]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          registered: false,
          message:    "Wallet belum terdaftar KYC",
        });
      }

      const e = rows[0];
      return res.json({
        registered:   true,
        id:           e.id,
        entity_type:  e.entity_type,
        name:         e.name,
        registered_at: e.created_at,
      });

    } catch (err) {
      console.error("[kyc] status error:", err.message);
      return res.status(500).json({ error: "Terjadi kesalahan server" });
    }
  }
);

// ── POST /kyc/petani ──────────────────────────────────────────────────────────
// Dipanggil saat koperasi akan ajukan advance
// Simpan data petani agar tidak fiktif — terikat ke entity koperasi
router.post("/kyc/petani",
  petaniRules, validate,
  async (req, res) => {
    const {
      wallet_pubkey,
      petani_nama, petani_nik, petani_npwp,
      petani_rekening, petani_bank,
      invoice_ref,
    } = req.body;

    try {
      // Cari entity_id dari wallet koperasi
      const [entities] = await pool.execute(
        `SELECT id, entity_type, name
         FROM entities WHERE wallet_pubkey = ? LIMIT 1`,
        [wallet_pubkey.trim()]
      );

      if (entities.length === 0) {
        return res.status(403).json({
          error: "Wallet koperasi belum terdaftar KYC. Daftar terlebih dahulu.",
        });
      }

      const entity = entities[0];

      if (entity.entity_type !== "koperasi") {
        return res.status(403).json({
          error: "Hanya koperasi yang dapat mengajukan data petani",
        });
      }

      // Normalisasi NIK & NPWP (hapus spasi/titik/strip)
      const nik  = petani_nik.replace(/\s/g, "");
      const npwp = petani_npwp.replace(/[.\-\s]/g, "");

      const [result] = await pool.execute(
        `INSERT INTO petani_submissions
           (entity_id, petani_nama, petani_nik, petani_npwp,
            petani_rekening, petani_bank, invoice_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          entity.id,
          petani_nama.trim(), nik, npwp,
          petani_rekening.trim(), petani_bank.trim(),
          invoice_ref.trim(),
        ]
      );

      console.log(
        `[kyc] petani submitted: "${petani_nama}" ` +
        `NIK=${nik.slice(0,6)}… ` +
        `oleh entity_id=${entity.id} "${entity.name}"`
      );

      return res.status(201).json({
        submission_id: result.insertId,
        petani_nama:   petani_nama.trim(),
        invoice_ref:   invoice_ref.trim(),
        submitted_at:  new Date().toISOString(),
        message:       "Data petani berhasil disimpan",
      });

    } catch (err) {
      console.error("[kyc] petani error:", err.message);
      return res.status(500).json({ error: "Terjadi kesalahan server" });
    }
  }
);

module.exports = router;
