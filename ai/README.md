# AI — Invoice Authenticity Classifier

XGBoost classifier untuk deteksi anomali pada invoice pengiriman TBS (Tandan Buah Segar) sawit. Dijalankan sebagai dua service terpisah via PM2 + uvicorn.

## Services

| Service | File | Port | Fungsi |
|---|---|---|---|
| `panen-model` | `model_server.py` | 4687 | Inference endpoint |
| `panen-relay-telegram` | `relay_server.py` | 4688 | Notifikasi Telegram |

## Model

- **Type:** XGBoostClassifier
- **F1 Score:** 0.9815
- **Threshold:** 0.628 (probability) → 62.8 (score integer)
- **On-chain threshold:** 70 — invoice dengan score ≥ 70 ditolak otomatis di program

File `model/classifier.pkl` tidak disertakan di repo karena ukuran. Generate dari notebook:

```bash
# Install dependencies
python -m venv venv
source venv/bin/activate      # Windows: venv\Scripts\activate
pip install -r requirements.txt

# Generate model
jupyter notebook training_pipeline.ipynb
# atau
python train.py
```

Lihat `model_info.json` untuk detail fitur, performa, dan format request.

## Setup

```bash
# 1. Clone dan masuk folder
cd ai

# 2. Virtual environment
python -m venv venv
source venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Generate model (wajib sebelum jalankan service)
python train.py

# 5. Buat folder log
mkdir -p log

# 6. Copy config PM2
cp ecosystem.config.example.json ecosystem.config.json
# Edit ecosystem.config.json — sesuaikan cwd dan env variables

# 7. Copy environment
cp .env.example .env
# Edit .env — isi TELEGRAM_BOT_TOKEN dan TELEGRAM_CHAT_ID

# 8. Jalankan via PM2
pm2 start ecosystem.config.json
pm2 save
```

## API

### `POST /verify` (port 4687)

Request:
```json
{
  "weight_kg": 5000,
  "price_per_kg": 2900,
  "invoice_value_idr": 14500000,
  "farm_area_ha": 2.0,
  "gps_lat": -0.354,
  "gps_lon": 102.071,
  "delivery_month": 4,
  "delivery_year": 2026
}
```

Response:
```json
{
  "status": "TERVERIFIKASI",
  "keaslian_score": 23,
  "probability": 0.23,
  "message": "Invoice terverifikasi — tidak terdeteksi anomali"
}
```

`keaslian_score` adalah nilai yang dikirim ke program on-chain sebagai `fraud_score`. Jika ≥ 70, receipt ditolak.

## Struktur

```
ai/
├── model_server.py              # FastAPI inference server
├── relay_server.py              # Telegram relay server
├── train.py                     # Script training model
├── training_pipeline.ipynb      # Notebook training + evaluasi
├── model_info.json              # Metadata model (tanpa file .pkl)
├── requirements.txt
├── .env.example
├── ecosystem.config.example.json
├── model/
│   └── classifier.pkl           # Generated — tidak di repo
└── log/                         # Generated — tidak di repo
```
