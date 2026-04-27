# -*- coding: utf-8 -*-
"""Model_Training.py

# 🌾 Panen Protocol — Invoice Data Authenticity Classifier
## Google Colab Training Notebook

**Dataset hybrid:** harga TBS dari sumber publik resmi + field statistik BPS  
**Model:** Random Forest + XGBoost, pilih yang terbaik otomatis  
**Output:** `model.pkl` + `model_info.json` → deploy ke Flask homelab

| Cell | Isi |
|------|-----|
| 1 | Install dependencies |
| 2 | Imports |
| 3 | Scraping + hardcoded harga TBS real |
| 4 | EDA harga real |
| 5 | Hybrid dataset generator (100K samples) |
| 6 | EDA dataset |
| 7 | Preprocessing & split |
| 8 | Train Random Forest (n_estimators=200) |
| 9 | Train XGBoost (n_estimators=200) |
| 10 | Final evaluation test set |
| 11 | Cross-validation 5-fold |
| 12 | Threshold analysis |
| 13 | Save model.pkl + model_info.json |
| 14 | Sanity check |
| 15 | Download files |

## Cell 1 — Install Dependencies
"""

!pip install requests beautifulsoup4 lxml pdfplumber \
    scikit-learn xgboost pandas numpy matplotlib seaborn joblib -q
print("✅ Done")

"""## Cell 2 — Imports"""

import re, time, random, json, warnings
import requests
import numpy as np
import pandas as pd
import joblib
import matplotlib.pyplot as plt
import seaborn as sns
from io import BytesIO
from bs4 import BeautifulSoup

from sklearn.ensemble        import RandomForestClassifier
from sklearn.model_selection import (train_test_split, cross_val_score,
                                      StratifiedKFold)
from sklearn.metrics         import (classification_report, confusion_matrix,
                                      roc_auc_score, precision_score,
                                      recall_score, f1_score,
                                      average_precision_score,
                                      precision_recall_curve)
import xgboost as xgb

warnings.filterwarnings("ignore")
np.random.seed(42)
random.seed(42)
print("✅ Imports OK")

"""## Cell 3 — Harga TBS Real (Scraping + Hardcoded)

**Sumber data `price_per_kg` yang real:**
1. **Hardcoded** dari Tabel 4.2 PDF Ditjen Perkebunan (2022–2026) — selalu tersedia  
2. **mediacenter.riau.go.id** — harga penetapan mingguan Riau  
   Fetch langsung ke known article IDs (dikonfirmasi dari web search), tanpa listing scan yang lambat. Sleep 0.3s/request.

>sawitindonesia.com tidak dapat di-scrape (403 Forbidden).

"""

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/120.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
}

def safe_get(url, timeout=8):
    try:
        r = requests.get(url, headers=HEADERS, timeout=timeout, verify=False)
        r.raise_for_status()
        return r
    except Exception as e:
        return None  # silent skip — tidak print agar tidak flood output

# ─── 1. Hardcoded: Tabel 4.2 Ditjen Perkebunan ───────────────────────────
# Harga TBS rata-rata nasional per bulan (IDR/kg, umur 10-20 thn)
# Sumber: Analisis Kinerja Perdagangan Kelapa Sawit 2024 & 2025 (Pusdatin)
MONTHLY_NATIONAL = {
    (2022,1):2756,(2022,2):3088,(2022,3):3253,(2022,4):3585,(2022,5):3312,
    (2022,6):3105,(2022,7):1811,(2022,8):2134,(2022,9):2298,(2022,10):2445,
    (2022,11):2512,(2022,12):2389,
    (2023,1):2201,(2023,2):2285,(2023,3):2312,(2023,4):2198,(2023,5):2156,
    (2023,6):2089,(2023,7):2178,(2023,8):2334,(2023,9):2412,(2023,10):2456,
    (2023,11):2423,(2023,12):2398,
    (2024,1):2513,(2024,2):2489,(2024,3):2534,(2024,4):2601,(2024,5):2578,
    (2024,6):2612,(2024,7):2598,(2024,8):2645,(2024,9):2701,(2024,10):2734,
    (2024,11):2712,(2024,12):2788,
    (2025,1):2876,(2025,2):2934,(2025,3):2998,(2025,4):3045,(2025,5):3012,
    (2025,6):2989,(2025,7):3067,(2025,8):3098,(2025,9):3134,(2025,10):3112,
    (2025,11):3089,(2025,12):3156,
    (2026,1):3298,(2026,2):3412,(2026,3):3634,(2026,4):3896,
}

# Faktor variasi harga per provinsi (sumber: Ditjen Perkebunan 2024)
PROVINCE_FACTORS = {
    "Riau":               (1.04,1.09), "Sumatera Utara":     (1.02,1.07),
    "Sumatera Barat":     (0.98,1.04), "Jambi":              (0.96,1.02),
    "Sumatera Selatan":   (0.97,1.03), "Lampung":            (0.92,0.98),
    "Kalimantan Barat":   (0.95,1.01), "Kalimantan Tengah":  (0.97,1.02),
    "Kalimantan Selatan": (0.90,0.97), "Kalimantan Timur":   (0.96,1.02),
    "Sulawesi":           (0.93,0.99),
}

def build_hardcoded():
    rows = []
    for (y,m), p in MONTHLY_NATIONAL.items():
        rows.append({"source":"ditjenbun","year":y,"month":m,
                     "province":"Nasional","price_idr":p})
        for prov,(fmin,fmax) in PROVINCE_FACTORS.items():
            rows.append({"source":"ditjenbun","year":y,"month":m,
                         "province":prov,
                         "price_idr":round(p * random.uniform(fmin,fmax))})
    return rows

# ─── 2. Scraper: mediacenter.riau.go.id ──────────────────────────────────
# URL pattern: /read/{ID}/slug.html
# Known article IDs — dikonfirmasi dari web search mengandung harga TBS.
# Setiap ID representasi satu periode penetapan harga (mingguan).
# Dari gap analisis: ID naik ~300-700 per artikel, rata-rata ~589.
# Known IDs: 88242(Okt W1), 88551(Okt W4), 88784(Nov W2), 88898(Nov W3),
#            89014(Nov W4), 89338(Des W3), 89438(Des W4/Jan),
#            90149(Feb W4), 90842(Apr W3), 90966(Apr W4), 94132(terbaru)

KNOWN_IDS = [
    # 2024 Q1 (estimasi berdasarkan gap ~589 mundur dari 88242)
    84000, 84600, 85200, 85800, 86400, 87000, 87600,
    # 2024 Q2-Q3 (estimasi)
    87000, 87300, 87600, 87900, 88000, 88100, 88200,
    # 2024 Q4 (dikonfirmasi dari search)
    88242, 88400, 88551, 88700, 88784, 88898, 89014,
    89100, 89200, 89338, 89438,
    # 2025 Q1
    89600, 89800, 90000, 90149, 90300, 90500,
    # 2025 Q2
    90700, 90842, 90966, 91100, 91300, 91500,
    # 2025 Q3-Q4
    91700, 91900, 92100, 92300, 92500, 92700,
    93000, 93200, 93400, 93600, 93800,
    # 2026
    94000, 94132, 94300, 94500,
]
KNOWN_IDS = sorted(set(KNOWN_IDS))

def parse_riau_article(html_text, url):
    """
    Parse artikel mediacenter.riau.go.id.
    Ekstrak harga TBS umur 9 atau 10 tahun + bulan/tahun periode.
    """
    import re
    MMAP = {"Januari":1,"Februari":2,"Maret":3,"April":4,"Mei":5,"Juni":6,
            "Juli":7,"Agustus":8,"September":9,"Oktober":10,"November":11,"Desember":12}

    # Cek relevansi — harus ada kata TBS
    if "TBS" not in html_text and "tandan buah segar" not in html_text.lower():
        return []

    soup    = BeautifulSoup(html_text, "lxml")
    content = soup.get_text(" ", strip=True)

    # Ekstrak bulan & tahun dari teks periode
    date_re = re.compile(
        r"(?:periode|Periode|berlaku).*?"
        r"(\d{1,2})\s*[-–]\s*\d{1,2}\s+"
        r"(Januari|Februari|Maret|April|Mei|Juni|Juli|"
        r"Agustus|September|Oktober|November|Desember)\s+(\d{4})",
        re.IGNORECASE | re.DOTALL
    )
    dm = date_re.search(content)
    if not dm:
        # fallback: cari tahun saja
        yr_m = re.search(r"(20\d\d)", content)
        if not yr_m: return []
        year, month = int(yr_m.group(1)), 0
    else:
        month = MMAP.get(dm.group(2), 0)
        year  = int(dm.group(3))

    if year < 2022 or year > 2026: return []

    # Ekstrak harga umur 9 atau 10 tahun
    # Format: "Umur 9 tahun: Rp 3.279,08/Kg" atau "Umur 9-10 tahun Rp3.279,08"
    records = []
    umur_re = re.compile(
        r"[Uu]mur\s+(\d+)(?:\s*[-–]\s*\d+)?\s*(?:tahun|th)[^0-9]{0,30}"
        r"Rp\s*([0-9][0-9.,]+)",
        re.DOTALL
    )
    for m in umur_re.finditer(content):
        umur = int(m.group(1))
        if umur not in {9, 10}: continue
        ps = re.sub(r"[.,]\d{2}$", "", m.group(2))
        ps = re.sub(r"[.,]", "", ps)
        try:
            price = int(ps)
            if 1500 <= price <= 8000:
                records.append({
                    "source":    "riau_mediacenter",
                    "year":      year,
                    "month":     month,
                    "province":  "Riau",
                    "price_idr": price,
                })
                break  # satu harga per artikel cukup
        except: pass

    # Fallback: harga apapun yang disebut dengan konteks "petani"
    if not records:
        fallback_re = re.compile(
            r"(?:petani|TBS)\s+(?:untuk|menjadi|sebesar|ditetapkan).*?"
            r"Rp\s*([0-9][0-9.,]+)\s*/\s*[Kk]g",
            re.IGNORECASE | re.DOTALL
        )
        fm = fallback_re.search(content)
        if fm:
            ps = re.sub(r"[.,]\d{2}$", "", fm.group(1))
            ps = re.sub(r"[.,]", "", ps)
            try:
                price = int(ps)
                if 2000 <= price <= 6000:
                    records.append({
                        "source":    "riau_mediacenter",
                        "year":      year,
                        "month":     month,
                        "province":  "Riau",
                        "price_idr": price,
                    })
            except: pass

    return records

def scrape_riau():
    """
    Fetch artikel dari KNOWN_IDS langsung — tanpa listing scan.
    Sleep 0.3s antar request (lebih cepat dari 0.8s, masih sopan).
    """
    base    = "https://mediacenter.riau.go.id"
    records = []
    hits    = 0

    print(f"  Fetching {len(KNOWN_IDS)} known article IDs...")
    for article_id in KNOWN_IDS:
        # Slug tidak perlu tepat — server redirect ke slug yang benar
        url = f"{base}/read/{article_id}/tbs.html"
        r   = safe_get(url)
        if not r:
            continue

        arts = parse_riau_article(r.text, url)
        if arts:
            records.extend(arts)
            hits += 1
            a = arts[0]
            print(f"  ✓ [{article_id}] {a['year']}-{a['month']:02d} "
                  f"Rp{a['price_idr']:,}/kg")
        time.sleep(0.3)  # jeda hormat, lebih cepat dari sebelumnya

    print(f"  → {hits}/{len(KNOWN_IDS)} artikel berhasil, {len(records)} records")
    return records

# ─── Jalankan semua sumber ─────────────────────────────────────────────────
print("[1/2] Hardcoded Ditjen Perkebunan...")
all_rows = build_hardcoded()
print(f"      {len(all_rows):,} records")

print("\n[2/2] mediacenter.riau.go.id (known IDs only)...")
riau_records = scrape_riau()
all_rows.extend(riau_records)

# ─── Build DataFrame ──────────────────────────────────────────────────────
df_prices = pd.DataFrame(all_rows)
df_prices = df_prices[df_prices["price_idr"].between(1000,8000)].copy()
df_prices = df_prices.drop_duplicates(
    subset=["source","year","month","province","price_idr"])
df_prices = df_prices.sort_values(["year","month"]).reset_index(drop=True)
df_prices.to_csv("harga_tbs_real.csv", index=False)

print(f"\n✅ Total: {len(df_prices):,} price records")
print(f"   Range: Rp{df_prices['price_idr'].min():,}–Rp{df_prices['price_idr'].max():,}/kg")
print(f"   Years: {df_prices['year'].min()}–{df_prices['year'].max()}")
print(df_prices["source"].value_counts().to_string())
print(f"\nRiau records per bulan:")
if "riau_mediacenter" in df_prices["source"].values:
    riau_df = df_prices[df_prices["source"]=="riau_mediacenter"]
    print(riau_df.groupby(["year","month"])["price_idr"].mean().round(0).to_string())

"""## Cell 4 — EDA Harga TBS Real"""

fig, axes = plt.subplots(1, 2, figsize=(14,4))

df_nat = (df_prices[df_prices["province"]=="Nasional"].copy()
          .assign(date=lambda d: pd.to_datetime(
              d["year"].astype(str)+"-"+d["month"].astype(str)+"-01"))
          .sort_values("date"))

axes[0].plot(df_nat["date"], df_nat["price_idr"], "b-o", markersize=4)
axes[0].set_title("Harga TBS Nasional (Ditjen Perkebunan 2022–2026)")
axes[0].set_ylabel("IDR/kg"); axes[0].set_xlabel("Periode")
axes[0].tick_params(axis="x", rotation=45); axes[0].grid(True, alpha=0.3)

(df_prices.groupby("province")["price_idr"].mean()
 .sort_values().plot(kind="barh", ax=axes[1], color="steelblue"))
axes[1].axvline(df_prices["price_idr"].mean(), color="red",
                linestyle="--", label="Rata-rata nasional")
axes[1].set_title("Rata-rata Harga TBS per Provinsi")
axes[1].set_xlabel("IDR/kg"); axes[1].legend()

plt.tight_layout()
plt.savefig("eda_harga_real.png", dpi=100, bbox_inches="tight"); plt.show()
print(df_prices["price_idr"].describe().round(0))

"""## Cell 5 — Hybrid Dataset Generator (100K samples)

| Field | Sumber |
|-------|--------|
| `price_per_kg` | **Real** — dari harga_tbs_real.csv (±2% variasi) |
| `delivery_month`, `delivery_year`, `province` | **Real** — dari data scraping |
| `farm_area_ha` | Statistik — log-normal (BPS 2023, mean 2.2 ha) |
| `weight_kg` | Statistik — derived dari farm × yield (BPS) |
| `gps_lat`, `gps_lon` | Statistik — centroid kabupaten sawit per provinsi |

"""

# GPS centroid kabupaten sawit per provinsi (dari peta BPS)
PROVINCE_GPS = {
    "Riau":              [(-0.30,101.45),(-0.50,102.10),(-0.80,101.80),(-1.20,102.50)],
    "Sumatera Utara":    [(2.80,99.10),(3.20,98.70),(2.50,99.50),(1.80,99.80)],
    "Sumatera Barat":    [(-0.90,100.35),(-1.20,100.80),(-0.50,99.90),(-1.80,101.20)],
    "Jambi":             [(-1.60,103.60),(-1.90,102.80),(-2.20,103.20),(-1.30,103.90)],
    "Sumatera Selatan":  [(-2.50,104.20),(-3.10,103.80),(-2.80,104.80),(-3.50,105.10)],
    "Lampung":           [(-4.80,105.20),(-5.10,104.80),(-4.50,105.60),(-5.40,105.00)],
    "Kalimantan Barat":  [(0.10,109.30),(-0.50,110.20),(0.80,108.50),(-1.20,110.80)],
    "Kalimantan Tengah": [(-1.80,113.90),(-2.20,112.80),(-1.50,114.50),(-2.80,113.20)],
    "Kalimantan Selatan":[(-3.10,115.30),(-2.80,115.80),(-3.50,114.90),(-2.50,116.10)],
    "Kalimantan Timur":  [(0.50,117.10),(-0.80,116.80),(1.20,116.50),(-1.50,117.40)],
    "Sulawesi":          [(-2.50,121.30),(-3.80,122.10),(-1.90,120.80),(-4.20,121.80)],
    "Nasional":          [(-0.30,101.45),(2.80,99.10),(-1.60,103.60),(0.10,109.30)],
}

PEAK_MONTHS  = {1,2,3,7,8,9}
YIELD_MIN    = 1.0;  YIELD_MAX    = 4.2
YIELD_REJECT = 10.0
FAKE_DATA_PATTERNS = [
    "yield_inflation","price_manipulation","arithmetic_fake","invalid_gps","offseason_spike","combined_yield_price","micro_farm_mega_weight",
]

def gps_valid(prov, jitter=0.3):
    pts  = PROVINCE_GPS.get(prov, [(-1.0,102.0)])
    base = random.choice(pts)
    return (round(base[0]+random.uniform(-jitter,jitter),6),
            round(base[1]+random.uniform(-jitter,jitter),6))

def gps_invalid():
    return random.choice([
        lambda: (random.uniform(-7,-4),   random.uniform(109,113)),
        lambda: (random.uniform(-20,-12), random.uniform(90,115)),
        lambda: (random.uniform(20,40),   random.uniform(100,130)),
        lambda: (0.0, 0.0),
    ])()

def farm_ha():
    return float(np.clip(np.random.lognormal(0.65,0.65), 0.25, 8.0))

def derived(w, p, inv, ha, lat, lon, mo, pmin, pmax):
    yha  = (w/1000) / max(ha, 0.01)
    pdev = (p-pmin) / max(pmax-pmin, 1)
    math = int(w*p > 0 and abs(inv-w*p)/(w*p) < 0.01)
    gps  = int(-11<=lat<=6 and 95<=lon<=141)
    peak = int(mo in PEAK_MONTHS)
    return yha, pdev, math, gps, peak

# ── Generate ───────────────────────────────────────────────
N_TOTAL     = 100_000
FAKE_DATA_RATIO = 0.20

price_recs  = df_prices.to_dict("records")
p_min = int(df_prices["price_idr"].quantile(0.05))
p_max = int(df_prices["price_idr"].quantile(0.95))
n_fake = int(N_TOTAL * FAKE_DATA_RATIO)
n_legit = N_TOTAL - n_fake

print(f"Generating {n_legit:,} legitimate + {n_fake:,} fake = {N_TOTAL:,} total")
rows = []

# Legitimate
for _ in range(n_legit):
    rec   = random.choice(price_recs)
    price = round(rec["price_idr"] * random.uniform(0.98,1.02))
    yr, mo, prov = rec["year"], rec["month"], rec.get("province","Nasional")
    ha    = farm_ha()
    s     = 1.0 if mo in PEAK_MONTHS else random.uniform(0.55,0.92)
    yha   = random.uniform(YIELD_MIN, YIELD_MAX) * s
    w     = round(ha * yha * 1000)
    inv   = w * price
    lat,lon = gps_valid(prov)
    yh,pd_,mt,gp,pk = derived(w,price,inv,ha,lat,lon,mo,p_min,p_max)
    rows.append({"farm_area_ha":round(ha,3),"weight_kg":w,"price_per_kg":price,
        "invoice_value_idr":inv,"gps_lat":lat,"gps_lon":lon,
        "delivery_month":mo,"delivery_year":yr,"province":prov,
        "yield_per_ha":round(yh,4),"price_deviation_pct":round(pd_,4),
        "math_consistent":mt,"gps_in_valid_zone":gp,"is_peak_month":pk,
        "label":0,"fake_data_pattern":"none","price_source":rec.get("source","real")})

# Fake Data
FW = [0.17,0.17,0.16,0.16,0.14,0.10,0.10]
for _ in range(n_fake):
    rec   = random.choice(price_recs)
    bp    = rec["price_idr"]
    yr, mo, prov = rec["year"], rec["month"], rec.get("province","Nasional")
    ha    = farm_ha()
    pat   = random.choices(FAKE_DATA_PATTERNS, weights=FW)[0]

    if pat == "yield_inflation":
        yha=random.uniform(YIELD_REJECT*1.2,60); w=round(ha*yha*1000)
        price=round(bp*random.uniform(0.98,1.02)); inv=w*price; lat,lon=gps_valid(prov)
    elif pat == "price_manipulation":
        yha=random.uniform(YIELD_MIN,YIELD_MAX); w=round(ha*yha*1000)
        price=round(bp*random.uniform(1.6,3.5)); inv=w*price; lat,lon=gps_valid(prov)
    elif pat == "arithmetic_fake":
        yha=random.uniform(YIELD_MIN,YIELD_MAX); w=round(ha*yha*1000)
        price=round(bp*random.uniform(0.98,1.02))
        inv=w*price*random.uniform(1.2,2.5); lat,lon=gps_valid(prov)
    elif pat == "invalid_gps":
        yha=random.uniform(YIELD_MIN,YIELD_MAX); w=round(ha*yha*1000)
        price=round(bp*random.uniform(0.98,1.02)); inv=w*price; lat,lon=gps_invalid()
    elif pat == "offseason_spike":
        mo=random.choice([m for m in range(1,13) if m not in PEAK_MONTHS])
        yha=random.uniform(YIELD_REJECT,40); w=round(ha*yha*1000)
        price=round(bp*random.uniform(0.98,1.02)); inv=w*price; lat,lon=gps_valid(prov)
    elif pat == "combined_yield_price":
        yha=random.uniform(YIELD_REJECT,35); w=round(ha*yha*1000)
        price=round(bp*random.uniform(1.6,3.5)); inv=w*price; lat,lon=gps_valid(prov)
    else:  # micro_farm_mega_weight
        ha=round(random.uniform(0.1,0.4),2); yha=random.uniform(YIELD_REJECT*2,100)
        w=round(ha*yha*1000); price=round(bp*random.uniform(0.98,1.02))
        inv=w*price; lat,lon=gps_valid(prov)

    yh,pd_,mt,gp,pk = derived(w,price,inv,ha,lat,lon,mo,p_min,p_max)
    rows.append({"farm_area_ha":round(ha,3),"weight_kg":w,"price_per_kg":price,
        "invoice_value_idr":inv,"gps_lat":lat,"gps_lon":lon,
        "delivery_month":mo,"delivery_year":yr,"province":prov,
        "yield_per_ha":round(yh,4),"price_deviation_pct":round(pd_,4),
        "math_consistent":mt,"gps_in_valid_zone":gp,"is_peak_month":pk,
        "label":1,"fake_data_pattern":pat,"price_source":rec.get("source","real")})

df = (pd.DataFrame(rows)
      .sample(frac=1,random_state=42).reset_index(drop=True)
      .replace([float("inf"),float("-inf")],0).fillna(0))
df.to_csv("panen_dataset_hybrid.csv", index=False)

print(f" ✅ panen_dataset_hybrid.csv — {len(df):,} samples")
print(f" Legitimate: {(df['label']==0).sum():,} | Fake: {(df['label']==1).sum():,}")
print(" Fake data patterns:")
print(df[df['label']==1]['fake_data_pattern'].value_counts().to_string())
print(" Price source:")
print(df['price_source'].value_counts().to_string())

"""## Cell 6 — EDA Dataset Hybrid"""

fig, axes = plt.subplots(2, 3, figsize=(15,8))
fig.suptitle("Feature Distribution — Hybrid Dataset (Real TBS Prices)", fontsize=13)

feats = [
    ("yield_per_ha",        "Yield per Ha (ton/ha/siklus)"),
    ("price_per_kg",        "Harga TBS (IDR/kg) — REAL"),
    ("price_deviation_pct", "Price Deviation"),
    ("weight_kg",           "Berat (kg)"),
    ("farm_area_ha",        "Luas Lahan (ha)"),
    ("delivery_month",      "Bulan Pengiriman"),
]
for ax, (feat,lbl) in zip(axes.flat, feats):
    df[df['label']==0][feat].hist(ax=ax, bins=50, alpha=0.6,
                                   color="steelblue", label="Legit")
    df[df['label']==1][feat].hist(ax=ax, bins=50, alpha=0.6,
                                   color="crimson", label="Fake")
    ax.set_title(lbl); ax.legend(fontsize=8)

plt.tight_layout()
plt.savefig("eda_dataset.png", dpi=100, bbox_inches="tight"); plt.show()
print("Price stats (IDR/kg):")
print(df.groupby('label')['price_per_kg'].describe().round(0))

"""## Cell 7 — Preprocessing & Split 70/15/15"""

FEATURES = [
    "yield_per_ha",       # derived: ton/ha/siklus
    "price_deviation_pct",# deviasi dari harga normal
    "math_consistent",    # invoice == weight × price
    "gps_in_valid_zone",  # GPS dalam zona sawit Indonesia
    "is_peak_month",      # bulan panen peak (1-3, 7-9)
    "weight_kg",          # berat TBS
    "farm_area_ha",       # luas lahan
    "price_per_kg",       # harga TBS (REAL dari scraping)
    "delivery_month",     # bulan (1-12)
    "delivery_year",      # tahun
]

X = np.nan_to_num(df[FEATURES].values, nan=0.0, posinf=9999.0, neginf=-9999.0)
y = df["label"].values

# Split 70/15/15 — stratified
X_tmp, X_test, y_tmp, y_test = train_test_split(
    X, y, test_size=0.15, random_state=42, stratify=y)
X_train, X_val, y_train, y_val = train_test_split(
    X_tmp, y_tmp, test_size=0.176, random_state=42, stratify=y_tmp)
# 0.176 × 0.85 ≈ 0.15 dari total

print(f"Train: {len(X_train):,} ({len(X_train)/len(X)*100:.0f}%)")
print(f"Val:   {len(X_val):,}   ({len(X_val)/len(X)*100:.0f}%)")
print(f"Test:  {len(X_test):,}  ({len(X_test)/len(X)*100:.0f}%)")
print(f"Features ({len(FEATURES)}): {FEATURES}")
print(f"NaN: {np.isnan(X).sum()} | Inf: {np.isinf(X).sum()}")

"""## Cell 8 — Train Random Forest (n_estimators=300)"""

print("Training Random Forest — n_estimators=300...")
rf = RandomForestClassifier(
    n_estimators     = 300,
    max_depth        = 15,
    min_samples_split= 5,
    min_samples_leaf = 2,
    max_features     = "sqrt",
    class_weight     = "balanced",
    random_state     = 42,
    n_jobs           = -1,
)
rf.fit(X_train, y_train)

yp  = rf.predict(X_val)
ypr = rf.predict_proba(X_val)[:,1]
print("Validation:")
print(classification_report(y_val, yp, target_names=["Legit","Fake"]))
print(f"ROC-AUC: {roc_auc_score(y_val, ypr):.4f}")

print("Feature Importances:")
for feat,imp in sorted(zip(FEATURES,rf.feature_importances_),key=lambda x:-x[1]):
    print(f"  {feat:<28} {imp:.4f}  {'█'*int(imp*50)}")

"""## Cell 9 — Train XGBoost (n_estimators=300)"""

neg, pos   = (y_train==0).sum(), (y_train==1).sum()
scale_w    = neg / pos
print(f"scale_pos_weight: {scale_w:.2f}")

xgb_m = xgb.XGBClassifier(
    n_estimators     = 300,
    max_depth        = 8,
    learning_rate    = 0.05,
    subsample        = 0.8,
    colsample_bytree = 0.8,
    scale_pos_weight = scale_w,
    eval_metric       = "logloss",
    random_state     = 42,
    n_jobs           = -1,
    verbosity        = 0,
)
print("Training XGBoost — n_estimators=300...")
xgb_m.fit(X_train, y_train, eval_set=[(X_val,y_val)], verbose=False)

yp  = xgb_m.predict(X_val)
ypr = xgb_m.predict_proba(X_val)[:,1]
print("Validation:")
print(classification_report(y_val, yp, target_names=["Legit","Fake"]))
print(f"ROC-AUC: {roc_auc_score(y_val, ypr):.4f}")

"""## Cell 10 — Final Evaluation on Test Set"""

def eval_test(name, model):
    yp  = model.predict(X_test)
    ypr = model.predict_proba(X_test)[:,1]
    cm  = confusion_matrix(y_test, yp)
    m   = {
        "name":      name,
        "precision": round(float(precision_score(y_test,yp)),4),
        "recall":    round(float(recall_score(y_test,yp)),4),
        "f1":        round(float(f1_score(y_test,yp)),4),
        "roc_auc":   round(float(roc_auc_score(y_test,ypr)),4),
        "ap":        round(float(average_precision_score(y_test,ypr)),4),
    }
    print("="*50)
    print(f"{name} — TEST SET")
    print(classification_report(y_test,yp,target_names=["Legit","Fake"]))
    print(f"  TN={cm[0,0]:5,}  FP={cm[0,1]:5,}")
    print(f"  FN={cm[1,0]:5,}  TP={cm[1,1]:5,}")
    print(f"  Precision={m['precision']}  Recall={m['recall']}")
    print(f"  F1={m['f1']}  AUC={m['roc_auc']}  AP={m['ap']}")
    return m

rf_m  = eval_test("Random Forest", rf)
xgb_m2= eval_test("XGBoost",       xgb_m)

if rf_m["f1"] >= xgb_m2["f1"]:
    best_model, best_name, best_m = rf,    "RandomForest", rf_m
else:
    best_model, best_name, best_m = xgb_m, "XGBoost",      xgb_m2

print(f"✅ Best model: {best_name} (F1={best_m['f1']})")

"""## Cell 11 — Cross-Validation (5-fold Stratified)"""

skf = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)

print("CV Random Forest (5-fold)...")
cv_rf  = cross_val_score(rf,    X, y, cv=skf, scoring="f1", n_jobs=-1)
print(f"RF  F1: {cv_rf.mean():.4f} ± {cv_rf.std():.4f}")

print("CV XGBoost (5-fold)...")
cv_xgb = cross_val_score(xgb_m, X, y, cv=skf, scoring="f1", n_jobs=-1)
print(f"XGB F1: {cv_xgb.mean():.4f} ± {cv_xgb.std():.4f}")

best_cv = cv_rf if best_model is rf else cv_xgb

"""## Cell 12 — Threshold Analysis"""

ypr = best_model.predict_proba(X_test)[:,1]
precs, recs, threshs = precision_recall_curve(y_test, ypr)

fig, axes = plt.subplots(1, 2, figsize=(12,4))

axes[0].plot(threshs, precs[:-1], "b-", label="Precision")
axes[0].plot(threshs, recs[:-1],  "r-", label="Recall")
axes[0].axvline(0.70, color="green", linestyle="--", label="Threshold=0.70")
axes[0].set(xlabel="Threshold", ylabel="Score",
            title=f"Precision-Recall vs Threshold ({best_name})")
axes[0].legend(); axes[0].grid(True, alpha=0.3)

f1s    = 2*(precs[:-1]*recs[:-1])/np.maximum(precs[:-1]+recs[:-1],1e-10)
best_t = threshs[np.argmax(f1s)]
axes[1].plot(threshs, f1s, "g-")
axes[1].axvline(0.70,   color="orange", linestyle="--", label="Threshold=0.70")
axes[1].axvline(best_t, color="red",    linestyle="--", label=f"Best={best_t:.2f}")
axes[1].set(xlabel="Threshold", ylabel="F1",
            title="F1 Score vs Threshold")
axes[1].legend(); axes[1].grid(True, alpha=0.3)

plt.tight_layout()
plt.savefig("threshold_analysis.png", dpi=100, bbox_inches="tight"); plt.show()
print(f"Optimal threshold: {best_t:.3f}")
print("Configured (Rust FAKE_DATA_REJECT_THRESHOLD): 0.70")

"""## Cell 13 — Save model.pkl + model_info.json"""

joblib.dump(best_model, "model.pkl", compress=3)
print("✅ model.pkl saved")

info = {
    "model_type":      best_name,
    "features":        FEATURES,
    "fake_data_threshold": 0.70,
    "n_samples":       int(len(X)),
    "n_train":         int(len(X_train)),
    "n_val":           int(len(X_val)),
    "n_test":          int(len(X_test)),
    "test_metrics":    best_m,
    "cv_f1_mean":      round(float(best_cv.mean()),4),
    "cv_f1_std":       round(float(best_cv.std()),4),
    "best_threshold_by_f1": round(float(best_t),3),
    "domain_thresholds": {
        "yield_per_ha_max_normal": 4.2,
        "yield_per_ha_suspicious": 6.0,
        "yield_per_ha_reject":     10.0,
        "price_per_kg_normal_min": int(df_prices["price_idr"].quantile(0.05)),
        "price_per_kg_normal_max": int(df_prices["price_idr"].quantile(0.95)),
    },
    "data_sources": [
        "Ditjen Perkebunan — Analisis Kinerja Perdagangan Kelapa Sawit 2024 & 2025",
        "APKASINDO — Harga TBS 2024-2025 (25 provinsi)",
        "mediacenter.riau.go.id — penetapan harga mingguan Riau",
        "BPS — Statistik Kelapa Sawit Indonesia 2023",
    ],
    "fake_data_patterns":       FAKE_DATA_PATTERNS,
    "price_real_records":   int(len(df_prices)),
    "price_sources":        df_prices["source"].value_counts().to_dict(),
}
if best_name == "RandomForest":
    info["feature_importances"] = {
        k: round(float(v),6)
        for k,v in sorted(zip(FEATURES,best_model.feature_importances_),
                           key=lambda x:-x[1])
    }

with open("model_info.json","w") as f:
    json.dump(info, f, indent=2)
print("✅ model_info.json saved")
print(f"\nSummary:")
print(f"  Model:   {best_name}")
print(f"  F1:      {best_m['f1']}")
print(f"  AUC:     {best_m['roc_auc']}")
print(f"  CV F1:   {info['cv_f1_mean']} ± {info['cv_f1_std']}")
print(f"  Samples: {len(X_train):,} train / {info['price_real_records']:,} real price records")

"""## Cell 14 — Sanity Check"""

D    = info["domain_thresholds"]
pref = int(df_prices["price_idr"].mean())
pmin = D["price_per_kg_normal_min"]
pmax = D["price_per_kg_normal_max"]
pd_n = (pref-pmin)/max(pmax-pmin,1)
pd_f = (pref*2.5-pmin)/max(pmax-pmin,1)

def chk(yha,pd,mt,gps,pk,w,ha,p,mo,yr):
    X_s  = np.array([[yha,pd,mt,gps,pk,w,ha,p,mo,yr]])
    prob = best_model.predict_proba(X_s)[0][1]
    sc   = int(prob*100)
    dec  = "REJECTED" if prob>=0.70 else "APPROVED"
    return sc, dec

print(f"Referensi harga real: Rp{pref:,}/kg\n")
tests = [
    ("✅ Legit — 2ha Sumatera harga real",    2.5,pd_n,1,1,1,5000, 2.0,pref,3,2025),
    ("✅ Legit — off-season 3ha yield rendah",1.2,pd_n,1,1,0,3600, 3.0,pref,6,2024),
    ("❌ Fake — yield inflation 50t/ha",     50.,pd_n,1,1,1,100000,2.0,pref,3,2025),
    ("❌ Fake — price 2.5× market",          2.5,pd_f,1,1,1,5000, 2.0,round(pref*2.5),3,2025),
    ("❌ Fake — GPS di laut (0,0)",           2.5,pd_n,1,0,1,5000, 2.0,pref,3,2025),
    ("❌ Fake — math tidak konsisten",        2.5,pd_n,0,1,1,5000, 2.0,pref,3,2025),
    ("❌ Fake — micro farm mega weight",      80.,pd_n,1,1,1,16000,0.2,pref,8,2025),
]
for desc,*vals in tests:
    sc,dec = chk(*vals)
    print(f"  {desc}")
    print(f"    fake_data_score={sc}/100 → {dec}\n")

"""## Cell 15 — Download Files"""

from google.colab import files
print("Downloading model files...")
files.download("model.pkl")
files.download("model_info.json")

# Uncomment untuk download juga:
# files.download("panen_dataset_hybrid.csv")
# files.download("harga_tbs_real.csv")
# files.download("eda_harga_real.png")
# files.download("eda_dataset.png")
# files.download("threshold_analysis.png")

print("\n✅ Selesai! Taruh model.pkl dan model_info.json di folder Flask homelab")