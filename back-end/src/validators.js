/**
 * validators.js — Validasi input KYC
 * Pakai express-validator untuk semua field
 */
const { body, param, validationResult } = require("express-validator");

// ── Helpers ──────────────────────────────────────────────────────────────────
const isValidNIK = (nik) => /^\d{16}$/.test(nik);

// NPWP: XX.XXX.XXX.X-XXX.XXX (15 digit) atau format baru 16 digit
const isValidNPWP = (npwp) => {
  const stripped = npwp.replace(/[.\-]/g, "");
  return /^\d{15,16}$/.test(stripped);
};

// Solana pubkey: Base58, 32-44 karakter
const isValidSolanaKey = (key) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(key);

// ── Middleware wrapper ────────────────────────────────────────────────────────
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      error:   "Validasi gagal",
      details: errors.array().map(e => ({ field: e.path, msg: e.msg })),
    });
  }
  next();
};

// ── Entity registration rules ─────────────────────────────────────────────────
const registerRules = [
  body("entity_type")
    .isIn(["koperasi", "mill"])
    .withMessage("entity_type harus 'koperasi' atau 'mill'"),

  body("name")
    .trim().isLength({ min: 3, max: 150 })
    .withMessage("Nama entitas minimal 3 karakter"),

  body("reg_number")
    .trim().isLength({ min: 5, max: 80 })
    .withMessage("Nomor registrasi/NPWP tidak valid"),

  body("address")
    .trim().isLength({ min: 10, max: 400 })
    .withMessage("Alamat minimal 10 karakter"),

  body("pic_name")
    .trim().isLength({ min: 3, max: 100 })
    .withMessage("Nama PIC minimal 3 karakter"),

  body("pic_phone")
    .trim().matches(/^(\+62|0)8[0-9]{8,12}$/)
    .withMessage("Nomor telepon tidak valid (format: 08xx atau +628xx)"),

  body("wallet_pubkey")
    .trim()
    .custom(v => {
      if (!isValidSolanaKey(v)) throw new Error("Wallet pubkey Solana tidak valid");
      return true;
    }),
];

// ── Petani submission rules ───────────────────────────────────────────────────
const petaniRules = [
  body("wallet_pubkey")
    .trim()
    .custom(v => {
      if (!isValidSolanaKey(v)) throw new Error("Wallet pubkey Solana tidak valid");
      return true;
    }),

  body("petani_nama")
    .trim().isLength({ min: 3, max: 150 })
    .withMessage("Nama petani minimal 3 karakter"),

  body("petani_nik")
    .trim()
    .custom(v => {
      const stripped = v.replace(/\s/g, "");
      if (!isValidNIK(stripped)) throw new Error("NIK harus 16 digit angka");
      return true;
    }),

  body("petani_npwp")
    .trim()
    .custom(v => {
      if (!isValidNPWP(v)) throw new Error("NPWP tidak valid (15-16 digit)");
      return true;
    }),

  body("petani_rekening")
    .trim().matches(/^\d{6,20}$/)
    .withMessage("Nomor rekening tidak valid (6-20 digit)"),

  body("petani_bank")
    .trim().isLength({ min: 2, max: 50 })
    .withMessage("Nama bank tidak valid"),

  body("invoice_ref")
    .trim().isLength({ min: 32, max: 100 })
    .withMessage("Invoice reference tidak valid"),
];

// ── Wallet param rule ─────────────────────────────────────────────────────────
const walletParam = [
  param("wallet")
    .trim()
    .custom(v => {
      if (!isValidSolanaKey(v)) throw new Error("Wallet pubkey tidak valid");
      return true;
    }),
];

module.exports = {
  validate,
  registerRules,
  petaniRules,
  walletParam,
};
