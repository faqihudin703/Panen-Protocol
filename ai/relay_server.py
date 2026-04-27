"""
relay_server.py — Public-facing Relay + Validation + Telegram Notifier
FastAPI · Port 5050 · 0.0.0.0
Expose via Cloudflare Tunnel ke frontend

Arsitektur per-request:
  [1] Rate limit
  [2] Type + range validation (Pydantic)
  [3] Domain pre-check (rule-based)
  [4] Forward ke model_server:5051
  [5] Kirim notifikasi Telegram (async, non-blocking)
  [6] Return response ke client

Threshold: 0.628 (optimal by F1 dari training)
"""

import json
import time
import hashlib
import logging
import asyncio
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx
from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, field_validator
from contextlib import asynccontextmanager

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [relay] %(message)s",
)
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────
MODEL_SERVER_URL = "http://localhost:5049"

# Threshold optimal by F1 dari training n_estimators=300
# Berbeda dari Rust FRAUD_REJECT_THRESHOLD (0.70) — intentional dual-layer
VERIFIKASI_THRESHOLD = 0.628

RATE_LIMIT_PER_MIN   = 60

# Telegram config — isi di sini atau pakai env var
BOT_TOKEN = "YOUR_BOT_TOKEN_HERE"
CHAT_ID   = "YOUR_CHAT_ID_HERE"

# Load domain thresholds dari model_info.json
BASE      = Path(__file__).parent
INFO_PATH = BASE / "model_info.json"
DOMAIN: dict = {}

@asynccontextmanager
async def lifespan(app: FastAPI):
    global DOMAIN
    if INFO_PATH.exists():
        info   = json.loads(INFO_PATH.read_text())
        DOMAIN = info.get("domain_thresholds", {})
        log.info(f"Domain thresholds loaded: {DOMAIN}")
    else:
        log.warning("model_info.json not found — using defaults")
        DOMAIN = {
            "yield_per_ha_max_normal": 4.2,
            "yield_per_ha_suspicious": 6.0,
            "yield_per_ha_reject":     10.0,
            "price_per_kg_normal_min": 2281,
            "price_per_kg_normal_max": 2974,
        }
    log.info(f"Relay server ready — threshold={VERIFIKASI_THRESHOLD}")
    yield

app = FastAPI(title="Panen Relay Server", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Rate limiter (in-memory) ──────────────────────────────────────────────────
_rate: dict = defaultdict(lambda: {"count": 0, "reset_at": 0.0})
_rate_lock  = asyncio.Lock()

async def check_rate(ip: str) -> bool:
    now = time.time()
    async with _rate_lock:
        b = _rate[ip]
        if now > b["reset_at"]:
            b["count"] = 0; b["reset_at"] = now + 60
        b["count"] += 1
        return b["count"] <= RATE_LIMIT_PER_MIN

# ── Request schema ─────────────────────────────────────────────────────────────
class VerifikasiRequest(BaseModel):
    weight_kg:          float = Field(..., gt=0, le=10_000_000)
    farm_area_ha:       float = Field(..., gt=0, le=100)
    price_per_kg:       float = Field(..., gt=0, le=50_000)
    invoice_value_idr:  float = Field(..., gt=0)
    gps_lat:            float = Field(..., ge=-90,  le=90)
    gps_lon:            float = Field(..., ge=-180, le=180)
    delivery_month:     int   = Field(default=6,    ge=1, le=12)
    delivery_year:      int   = Field(default=2025, ge=2010, le=2030)

    @field_validator("gps_lat")
    @classmethod
    def lat_valid(cls, v: float) -> float:
        return v  # range sudah di Field

    class Config:
        json_schema_extra = {
            "example": {
                "weight_kg": 5000, "farm_area_ha": 2.0,
                "price_per_kg": 2900, "invoice_value_idr": 14500000,
                "gps_lat": -0.5, "gps_lon": 101.4,
                "delivery_month": 3, "delivery_year": 2025,
            }
        }

# ── Domain pre-check ───────────────────────────────────────────────────────────
def domain_precheck(r: VerifikasiRequest) -> list[dict]:
    catatan = []
    p_min = DOMAIN.get("price_per_kg_normal_min", 2281)
    p_max = DOMAIN.get("price_per_kg_normal_max", 2974)
    y_max = DOMAIN.get("yield_per_ha_max_normal", 4.2)
    y_sus = DOMAIN.get("yield_per_ha_suspicious", 6.0)
    y_rej = DOMAIN.get("yield_per_ha_reject",     10.0)

    # 1. Aritmatika invoice
    if r.weight_kg > 0 and r.price_per_kg > 0:
        exp      = r.weight_kg * r.price_per_kg
        diff_pct = abs(r.invoice_value_idr - exp) / exp * 100
        if diff_pct > 2.0:
            catatan.append({
                "field":     "invoice_value_idr",
                "value":     r.invoice_value_idr,
                "expected":  exp,
                "diff_pct":  round(diff_pct, 2),
                "catatan":   f"Invoice Rp{r.invoice_value_idr:,.0f} ≠ {r.weight_kg:,.0f}kg × Rp{r.price_per_kg:,.0f} = Rp{exp:,.0f} (selisih {diff_pct:.1f}%)",
                "prioritas": "tinggi",
            })

    # 2. Yield per ha
    if r.farm_area_ha > 0 and r.weight_kg > 0:
        y = (r.weight_kg / 1000) / r.farm_area_ha
        if y > y_rej:
            catatan.append({
                "field": "yield_per_ha", "value": round(y, 2), "batas": y_rej,
                "catatan":   f"Produktivitas {y:.1f} ton/ha melampaui batas fisik ({y_rej} ton/ha)",
                "prioritas": "tinggi",
            })
        elif y > y_sus:
            catatan.append({
                "field": "yield_per_ha", "value": round(y, 2), "batas": y_sus,
                "catatan":   f"Produktivitas {y:.1f} ton/ha di atas rentang normal (maks {y_max} ton/ha)",
                "prioritas": "sedang",
            })

    # 3. Harga per kg
    if r.price_per_kg > p_max * 1.6:
        catatan.append({
            "field": "price_per_kg", "value": r.price_per_kg, "batas": p_max,
            "catatan":   f"Harga Rp{r.price_per_kg:,.0f}/kg di atas pasar TBS (Rp{p_min:,}–{p_max:,}/kg)",
            "prioritas": "sedang",
        })

    # 4. GPS Indonesia
    if not (-11.0 <= r.gps_lat <= 6.0 and 95.0 <= r.gps_lon <= 141.0):
        catatan.append({
            "field": "gps_coordinates",
            "value": {"lat": r.gps_lat, "lon": r.gps_lon},
            "catatan":   f"Koordinat ({r.gps_lat}, {r.gps_lon}) di luar wilayah sawit Indonesia",
            "prioritas": "tinggi",
        })

    # 5. Off-season spike
    if r.delivery_month not in {1,2,3,7,8,9} and r.farm_area_ha > 0:
        y = (r.weight_kg / 1000) / r.farm_area_ha
        if y > y_sus:
            catatan.append({
                "field": "delivery_month", "value": r.delivery_month,
                "catatan":   f"Volume tinggi ({y:.1f} ton/ha) di bulan ke-{r.delivery_month} (bukan musim peak)",
                "prioritas": "rendah",
            })

    return catatan

# ── Telegram notifier ─────────────────────────────────────────────────────────
def build_chart(score: int) -> str:
    """ASCII bar chart keaslian score untuk Telegram."""
    filled = score // 5       # max 20 blok
    empty  = 20 - filled
    color  = "🟢" if score < 40 else "🟡" if score < 63 else "🔴"
    bar    = "█" * filled + "░" * empty
    return f"{color} [{bar}] {score}/100"

async def notify_telegram(
    request_id: str,
    req:        VerifikasiRequest,
    score:      int,
    prob:       float,
    status:     str,
    catatan:    list[dict],
    inference_ms: int,
    total_ms:   int,
):
    """Kirim notifikasi Telegram async — non-blocking, tidak menghambat response."""
    if "ISI_" in BOT_TOKEN or "ISI_" in str(CHAT_ID):
        return  # skip kalau belum dikonfigurasi

    status_icon = "✅" if status == "TERVERIFIKASI" else "⚠️"
    now_str     = datetime.now().strftime("%d %b %Y %H:%M WIB")

    # Summary chart
    chart = build_chart(score)

    # Catatan kritis
    catatan_txt = ""
    if catatan:
        lines = []
        for c in catatan:
            icon = "🔴" if c["prioritas"] == "tinggi" else "🟡" if c["prioritas"] == "sedang" else "⚪"
            lines.append(f"  {icon} [{c['prioritas']}] {c['catatan']}")
        catatan_txt = "\n*Catatan:*\n" + "\n".join(lines)

    msg = (
        f"*Panen Protocol — Hasil Verifikasi Invoice*\n"
        f"_{now_str}_\n\n"
        f"*Status:* {status_icon} `{status}`\n"
        f"*Skor Keaslian:*\n`{chart}`\n\n"
        f"*Detail Invoice:*\n"
        f"  Berat:    `{req.weight_kg:,.0f} kg`\n"
        f"  Harga:    `Rp{req.price_per_kg:,.0f}/kg`\n"
        f"  Invoice:  `Rp{req.invoice_value_idr:,.0f}`\n"
        f"  Lahan:    `{req.farm_area_ha} ha`\n"
        f"  GPS:      `{req.gps_lat}, {req.gps_lon}`\n"
        f"  Periode:  `{req.delivery_month}/{req.delivery_year}`\n"
        f"{catatan_txt}\n"
        f"*Performa:*\n"
        f"  ML inference: `{inference_ms}ms` · Total: `{total_ms}ms`\n"
        f"  Request ID: `{request_id}`"
    )

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage",
                json={
                    "chat_id":    CHAT_ID,
                    "text":       msg,
                    "parse_mode": "Markdown",
                },
            )
        log.info(f"[{request_id}] Telegram notification sent")
    except Exception as e:
        log.warning(f"[{request_id}] Telegram failed: {e}")

# ── Request ID ────────────────────────────────────────────────────────────────
def make_id(data: str, ip: str) -> str:
    raw = data + ip + str(time.time())
    return hashlib.sha256(raw.encode()).hexdigest()[:12]

# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    model_ok = False
    try:
        async with httpx.AsyncClient(timeout=3) as c:
            r = await c.get(f"{MODEL_SERVER_URL}/health")
            model_ok = r.status_code == 200
    except Exception:
        pass
    return {
        "status":              "ok",
        "relay":               True,
        "model_server":        model_ok,
        "verifikasi_threshold": VERIFIKASI_THRESHOLD,
        "timestamp":           datetime.utcnow().isoformat(),
    }

@app.get("/info")
async def info():
    if not INFO_PATH.exists():
        raise HTTPException(status_code=404, detail="model_info.json not found")
    i = json.loads(INFO_PATH.read_text())
    return {
        "model_type":            i.get("model_type"),
        "f1_score":              i.get("test_metrics", {}).get("f1"),
        "roc_auc":               i.get("test_metrics", {}).get("roc_auc"),
        "verifikasi_threshold":  VERIFIKASI_THRESHOLD,
        "features":              i.get("features", []),
        "data_sources":          i.get("data_sources", []),
    }

@app.post("/verifikasi")
async def verifikasi(req: VerifikasiRequest, request: Request):
    t0        = time.time()
    client_ip = request.client.host if request.client else "unknown"

    # [1] Rate limit
    if not await check_rate(client_ip):
        raise HTTPException(status_code=429, detail="Rate limit exceeded. Maks 60 req/menit.")

    request_id = make_id(req.model_dump_json(), client_ip)

    try:
        # [2] Domain pre-check
        catatan        = domain_precheck(req)
        catatan_kritis = [c for c in catatan if c["prioritas"] == "tinggi"]

        # [3] Forward ke model server
        inference_ms = 0
        prob         = 0.5

        try:
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(
                    f"{MODEL_SERVER_URL}/infer",
                    json=req.model_dump(),
                )
                r.raise_for_status()
                result       = r.json()
                prob         = float(result["keaslian_prob"])
                inference_ms = int(result.get("inference_ms", 0))
        except Exception as e:
            log.error(f"[{request_id}] Model server error: {e}")
            # Fallback: gunakan domain check saja
            prob = (VERIFIKASI_THRESHOLD + 0.05) if catatan_kritis else 0.30

        # Critical domain flags override
        if catatan_kritis:
            prob = max(prob, VERIFIKASI_THRESHOLD + 0.01)

        score  = int(round(prob * 100))
        status = "PERLU_VERIFIKASI" if prob >= VERIFIKASI_THRESHOLD else "TERVERIFIKASI"

        total_ms = int((time.time() - t0) * 1000)

        log.info(
            f"[{request_id}] ip={client_ip} score={score} "
            f"status={status} catatan={len(catatan)} "
            f"infer_ms={inference_ms} total_ms={total_ms}"
        )

        # [4] Kirim ke Telegram async — fire and forget
        asyncio.create_task(notify_telegram(
            request_id, req, score, prob, status,
            catatan, inference_ms, total_ms,
        ))

        return {
            "request_id":         request_id,
            "keaslian_score":     score,
            "keaslian_prob":      round(prob, 4),
            "status":             status,
            "catatan_verifikasi": catatan,
            "inference_ms":       inference_ms,
            "total_ms":           total_ms,
        }

    except HTTPException:
        raise
    except Exception as e:
        log.error(f"[{request_id}] Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Internal error")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("relay_server:app", host="0.0.0.0", port=4688,
                reload=False, log_level="info")
