# Backend — KYC Service

REST API untuk registrasi dan verifikasi identitas koperasi, mill, dan petani. Dibangun dengan Node.js + Express + MySQL.

## Prerequisites

- Node.js 18+
- MySQL 8+

## Setup

```bash
cd backend

# 1. Install dependencies
npm install

# 2. Buat database MySQL
mysql -u root -p
CREATE DATABASE panen_kyc;
CREATE USER 'panenuser'@'localhost' IDENTIFIED BY 'yourpassword';
GRANT ALL PRIVILEGES ON panen_kyc.* TO 'panenuser'@'localhost';
FLUSH PRIVILEGES;

# 3. Copy environment
cp .env.example .env
# Edit .env — isi DB credentials

# 4. Jalankan migrasi schema
npm run migrate

# 5. Development
npm run dev

# 6. Production (via PM2)
pm2 start ecosystem.config.json
pm2 save
```

## API Endpoints

### KYC

| Method | Endpoint | Fungsi |
|---|---|---|
| `POST` | `/kyc/register` | Daftarkan koperasi atau mill |
| `GET` | `/kyc/status/:wallet` | Cek status registrasi wallet |
| `POST` | `/kyc/petani` | Simpan data petani (post-advance) |
| `GET` | `/kyc/petani/:wallet` | Ambil data petani |

### Register Request Body

```json
{
  "entity_type": "koperasi",
  "name": "Koperasi Sawit Maju Bersama",
  "reg_number": "518/BH/KOP/IV/2019",
  "address": "Jl. Lintas Timur No.12, Kab. Pelalawan, Riau",
  "pic_name": "Budi Santoso",
  "pic_phone": "081234567890",
  "wallet_pubkey": "AbCd1234..."
}
```

### Status Response

```json
{
  "status": "registered",
  "entity_type": "koperasi",
  "name": "Koperasi Sawit Maju Bersama"
}
```

## Struktur

```
back-end/
├── src/
│   ├── index.js
│   ├── db.js
│   ├── routes.js
│   ├── validators.js
│   └── migrate.js
├── package.json
└── .env.example
```
