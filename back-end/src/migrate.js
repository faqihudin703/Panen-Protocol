/**
 * migrate.js — Buat tabel MySQL
 * Jalankan sekali: node src/migrate.js
 */
require("dotenv").config();
const pool = require("./db");

async function migrate() {
  const conn = await pool.getConnection();
  try {
    console.log("[migrate] Creating tables...");

    // Tabel utama: entitas yang terdaftar (koperasi & mill)
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS entities (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        entity_type     ENUM('koperasi','mill') NOT NULL,
        name            VARCHAR(150) NOT NULL COMMENT 'Nama koperasi / mill',
        reg_number      VARCHAR(80)  NOT NULL UNIQUE
                        COMMENT 'Nomor BH koperasi atau NPWP mill',
        address         VARCHAR(400) NOT NULL,
        pic_name        VARCHAR(100) NOT NULL COMMENT 'Nama PIC',
        pic_phone       VARCHAR(20)  NOT NULL COMMENT 'No HP/WA PIC',
        wallet_pubkey   VARCHAR(44)  NOT NULL UNIQUE
                        COMMENT 'Solana pubkey Base58',
        created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                        ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_type   (entity_type),
        INDEX idx_wallet (wallet_pubkey)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    // Tabel petani yang dilampirkan ke submission
    // Disimpan saat ajukan advance, bukan saat register entitas
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS petani_submissions (
        id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        entity_id       INT UNSIGNED NOT NULL
                        COMMENT 'FK ke entities (koperasi yang mengajukan)',
        petani_nama     VARCHAR(150) NOT NULL COMMENT 'Nama lengkap petani',
        petani_nik      VARCHAR(20)  NOT NULL COMMENT 'NIK petani (16 digit)',
        petani_npwp     VARCHAR(20)  NOT NULL COMMENT 'NPWP petani (15-16 digit)',
        petani_rekening VARCHAR(30)  NOT NULL COMMENT 'No rekening penerima IDR',
        petani_bank     VARCHAR(50)  NOT NULL COMMENT 'Nama bank',
        invoice_ref     VARCHAR(100) NOT NULL COMMENT 'Reference dari program on-chain',
        submitted_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE RESTRICT,
        INDEX idx_entity  (entity_id),
        INDEX idx_nik     (petani_nik),
        INDEX idx_invoice (invoice_ref)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    console.log("[migrate] Done — tables ready");
  } finally {
    conn.release();
    await pool.end();
  }
}

migrate().catch(e => {
  console.error("[migrate] Failed:", e.message);
  process.exit(1);
});
