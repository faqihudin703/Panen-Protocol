"""
model_server.py — ML Inference Server (Internal)
FastAPI · Port 5051 · 0.0.0.0
Hanya menerima request dari relay_server.py (internal network)
Tidak boleh diekspos langsung ke publik
"""

import json
import time
import logging
import numpy as np
import joblib
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [model] %(message)s",
)
log = logging.getLogger(__name__)

# ── Load model on startup ──────────────────────────────────────────────────────
BASE  = Path(__file__).parent
MODEL = None
INFO  = {}

@asynccontextmanager
async def lifespan(app: FastAPI):
    global MODEL, INFO
    MODEL = joblib.load(BASE / "model.pkl")
    INFO  = json.loads((BASE / "model_info.json").read_text())
    log.info(f"Model loaded: {INFO['model_type']} | F1={INFO['test_metrics']['f1']}")
    log.info(f"Features: {len(INFO['features'])}")
    yield
    log.info("Model server shutting down")

app = FastAPI(title="Panen Model Server", lifespan=lifespan)

# ── Schemas ───────────────────────────────────────────────────────────────────
class InferRequest(BaseModel):
    weight_kg:          float = Field(..., gt=0)
    farm_area_ha:       float = Field(..., gt=0)
    price_per_kg:       float = Field(..., gt=0)
    invoice_value_idr:  float = Field(..., gt=0)
    gps_lat:            float
    gps_lon:            float
    delivery_month:     int   = Field(default=6, ge=1, le=12)
    delivery_year:      int   = Field(default=2025, ge=2010, le=2030)

class InferResponse(BaseModel):
    keaslian_prob: float
    inference_ms:  int

# ── Feature builder ────────────────────────────────────────────────────────────
def build_features(r: InferRequest) -> np.ndarray:
    domain  = INFO.get("domain_thresholds", {})
    p_min   = domain.get("price_per_kg_normal_min", 2281)
    p_range = domain.get("price_per_kg_normal_max", 2974) - p_min

    yield_pha = (r.weight_kg / 1000) / max(r.farm_area_ha, 0.01)
    price_dev = (r.price_per_kg - p_min) / max(p_range, 1)
    expected  = r.weight_kg * r.price_per_kg
    math_ok   = int(expected > 0 and abs(r.invoice_value_idr - expected) / expected < 0.02)
    gps_ok    = int(-11.0 <= r.gps_lat <= 6.0 and 95.0 <= r.gps_lon <= 141.0)
    is_peak   = int(r.delivery_month in {1, 2, 3, 7, 8, 9})

    fm = {
        "yield_per_ha":        yield_pha,
        "price_deviation_pct": price_dev,
        "math_consistent":     math_ok,
        "gps_in_valid_zone":   gps_ok,
        "is_peak_month":       is_peak,
        "weight_kg":           r.weight_kg,
        "farm_area_ha":        r.farm_area_ha,
        "price_per_kg":        r.price_per_kg,
        "delivery_month":      r.delivery_month,
        "delivery_year":       r.delivery_year,
    }
    features = INFO.get("features", list(fm.keys()))
    return np.array([[fm.get(f, 0.0) for f in features]])

# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/health")
async def health():
    return {
        "status":   "ok",
        "model":    INFO.get("model_type"),
        "f1":       INFO.get("test_metrics", {}).get("f1"),
        "features": len(INFO.get("features", [])),
    }

@app.post("/infer", response_model=InferResponse)
async def infer(req: InferRequest):
    if MODEL is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    t0 = time.time()
    try:
        X    = build_features(req)
        X    = np.nan_to_num(X, nan=0.0, posinf=999.0, neginf=-999.0)
        prob = float(MODEL.predict_proba(X)[0][1])
        ms   = int((time.time() - t0) * 1000)
        log.info(f"infer: prob={prob:.4f} ms={ms}")
        return InferResponse(keaslian_prob=prob, inference_ms=ms)
    except Exception as e:
        log.error(f"Inference error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("model_server:app", host="0.0.0.0", port=4687,
                reload=False, log_level="info")
