"""
DFIS — Delhi Flood Intelligence System
ml_model.py — XGBoost + LSTM Training Pipeline

Handles class imbalance (only 0.4% flood days) using:
  - SMOTE oversampling
  - Class weights
  - Threshold tuning for best F1

Usage:
    pip install xgboost scikit-learn imbalanced-learn tensorflow pandas numpy joblib
    python ml_model.py

Outputs:
    models/xgboost_flood_model.pkl
    models/lstm_flood_model.h5   (or .keras)
    models/scaler.pkl
    models/model_metadata.json
"""

import os, json, warnings
import numpy as np
import pandas as pd
import joblib
warnings.filterwarnings('ignore')

# ── Paths ──────────────────────────────────────────────────
BASE_DIR   = os.path.dirname(os.path.abspath(__file__))
DATA_DIR   = os.path.normpath(os.path.join(BASE_DIR, '..', 'data'))
MODELS_DIR = os.path.join(BASE_DIR, '..', 'models')
CSV_PATH   = os.path.join(DATA_DIR, 'delhi_historical_floods.csv')

os.makedirs(MODELS_DIR, exist_ok=True)

# ── Feature columns used for training ──────────────────────
FEATURES = [
    'rainfall_mm', 'rainfall_max_mm', 'rainfall_intensity',
    'rainfall_3day', 'rainfall_7day', 'rainfall_15day',
    'soil_saturation', 'is_monsoon', 'monsoon_day',
    'yamuna_level_m', 'yamuna_level_change', 'yamuna_discharge',
    'elevation_m', 'slope_deg', 'flow_accumulation',
    'drain_capacity_pct', 'impervious_pct', 'drain_blockage_idx',
    'yamuna_proximity_m',
]
TARGET = 'flood_occurred'

# ───────────────────────────────────────────────────────────
print("=" * 60)
print("DFIS — Flood Prediction Model Training")
print("=" * 60)

# ── 1. Load Data ────────────────────────────────────────────
print(f"\n[1/6] Loading data from:\n      {CSV_PATH}")
if not os.path.exists(CSV_PATH):
    print(f"❌ File not found: {CSV_PATH}")
    print("   Run extract_delhi_rainfall.py first.")
    exit(1)

df = pd.read_csv(CSV_PATH, parse_dates=['date'])
print(f"      Rows: {len(df):,}  |  Columns: {len(df.columns)}")
print(f"      Years: {df['year'].min()}–{df['year'].max()}")
print(f"      Flood days: {df[TARGET].sum()} ({df[TARGET].mean()*100:.2f}%)")

# ── 2. Prepare features ─────────────────────────────────────
print("\n[2/6] Preparing features...")

# Fill any NaNs
df[FEATURES] = df[FEATURES].fillna(0)

X = df[FEATURES].values
y = df[TARGET].values

# Temporal train/val split (no shuffle — avoid data leakage)
# Train: 2007–2021  |  Val: 2022–2025
train_mask = df['year'] <= 2021
val_mask   = df['year'] >= 2022

X_train, y_train = X[train_mask], y[train_mask]
X_val,   y_val   = X[val_mask],   y[val_mask]

print(f"      Train: {len(X_train):,} rows ({y_train.sum()} floods)")
print(f"      Val  : {len(X_val):,} rows ({y_val.sum()} floods)")

# ── 3. Scale features ───────────────────────────────────────
print("\n[3/6] Scaling features...")
from sklearn.preprocessing import StandardScaler
scaler = StandardScaler()
X_train_sc = scaler.fit_transform(X_train)
X_val_sc   = scaler.transform(X_val)
joblib.dump(scaler, os.path.join(MODELS_DIR, 'scaler.pkl'))
print("      StandardScaler fitted and saved.")

# ── 4. Handle class imbalance ────────────────────────────────
print("\n[4/6] Handling class imbalance...")

# Calculate scale_pos_weight for XGBoost (ratio of negatives to positives)
n_neg   = int((y_train == 0).sum())
n_pos   = int((y_train == 1).sum())
spw     = round(n_neg / max(n_pos, 1), 1)
print(f"      Negatives: {n_neg}  |  Positives: {n_pos}")
print(f"      scale_pos_weight = {spw}")

# Try SMOTE if available
try:
    from imblearn.over_sampling import SMOTE
    sm = SMOTE(random_state=42, k_neighbors=min(5, n_pos - 1))
    X_train_res, y_train_res = sm.fit_resample(X_train_sc, y_train)
    print(f"      SMOTE applied → {len(X_train_res):,} samples "
          f"({int(y_train_res.sum())} floods)")
    use_smote = True
except Exception as e:
    print(f"      SMOTE skipped ({e}). Using class weights instead.")
    X_train_res, y_train_res = X_train_sc, y_train
    use_smote = False

# ── 5. Train XGBoost ────────────────────────────────────────
print("\n[5/6] Training XGBoost classifier...")
from xgboost import XGBClassifier
from sklearn.metrics import (
    classification_report, roc_auc_score,
    precision_recall_curve, f1_score, confusion_matrix
)

xgb_params = dict(
    n_estimators      = 300,
    max_depth         = 6,
    learning_rate     = 0.05,
    subsample         = 0.8,
    colsample_bytree  = 0.8,
    scale_pos_weight  = 1 if use_smote else spw,
    eval_metric       = 'logloss',
    random_state      = 42,
    n_jobs            = -1,
)

xgb = XGBClassifier(**xgb_params)
xgb.fit(
    X_train_res, y_train_res,
    eval_set=[(X_val_sc, y_val)],
    verbose=False,
)

# Predict probabilities
y_prob = xgb.predict_proba(X_val_sc)[:, 1]

# Find best threshold by F1 score
precisions, recalls, thresholds = precision_recall_curve(y_val, y_prob)
f1_scores = 2 * precisions * recalls / (precisions + recalls + 1e-9)
best_idx   = np.argmax(f1_scores)
best_thr   = float(thresholds[best_idx]) if best_idx < len(thresholds) else 0.5
best_f1    = float(f1_scores[best_idx])

print(f"\n      Best threshold : {best_thr:.3f}")
print(f"      Best F1 score  : {best_f1:.3f}")

y_pred = (y_prob >= best_thr).astype(int)

auc = roc_auc_score(y_val, y_prob) if y_val.sum() > 0 else 0.0
acc = float((y_pred == y_val).mean())

print(f"\n      AUC-ROC  : {auc:.4f}")
print(f"      Accuracy : {acc:.4f}")
print(f"\n      Classification Report:")
print(classification_report(y_val, y_pred, target_names=['No Flood', 'Flood'], zero_division=0))

cm = confusion_matrix(y_val, y_pred)
print(f"      Confusion Matrix:")
print(f"        Predicted →   No Flood   Flood")
print(f"        No Flood   :  {cm[0][0]:>6}    {cm[0][1]:>5}")
print(f"        Flood      :  {cm[1][0]:>6}    {cm[1][1]:>5}")

# Feature importance
fi = pd.Series(xgb.feature_importances_, index=FEATURES).sort_values(ascending=False)
print(f"\n      Top 10 Feature Importances:")
for feat, imp in fi.head(10).items():
    bar = '█' * int(imp * 100)
    print(f"        {feat:<30} {bar} {imp:.4f}")

# Save XGBoost model
xgb_path = os.path.join(MODELS_DIR, 'xgboost_flood_model.pkl')
joblib.dump(xgb, xgb_path)
print(f"\n      ✅ XGBoost model saved → {xgb_path}")

# ── 6. Train LSTM ────────────────────────────────────────────
print("\n[6/6] Training LSTM (6-hour rainfall forecaster)...")

lstm_trained = False
try:
    import tensorflow as tf
    from tensorflow.keras.models import Sequential
    from tensorflow.keras.layers import LSTM, Dense, Dropout, Input
    from tensorflow.keras.callbacks import EarlyStopping, ReduceLROnPlateau

    tf.get_logger().setLevel('ERROR')

    SEQ_LEN = 14  # 14-day lookback window

    def make_sequences(X_sc, y, seq_len=SEQ_LEN):
        Xs, ys = [], []
        for i in range(seq_len, len(X_sc)):
            Xs.append(X_sc[i - seq_len:i])
            ys.append(y[i])
        return np.array(Xs), np.array(ys)

    X_seq_train, y_seq_train = make_sequences(X_train_sc, y_train)
    X_seq_val,   y_seq_val   = make_sequences(X_val_sc,   y_val)

    print(f"      LSTM sequences → Train: {X_seq_train.shape}  Val: {X_seq_val.shape}")

    model = Sequential([
        Input(shape=(SEQ_LEN, len(FEATURES))),
        LSTM(64, return_sequences=True),
        Dropout(0.3),
        LSTM(32),
        Dropout(0.2),
        Dense(16, activation='relu'),
        Dense(1,  activation='sigmoid'),
    ])

    model.compile(
        optimizer=tf.keras.optimizers.Adam(learning_rate=0.001),
        loss='binary_crossentropy',
        metrics=['accuracy'],
    )

    # Class weight for LSTM
    cw = {0: 1.0, 1: float(spw)}

    callbacks = [
        EarlyStopping(monitor='val_loss', patience=10, restore_best_weights=True),
        ReduceLROnPlateau(monitor='val_loss', factor=0.5, patience=5, min_lr=1e-5),
    ]

    history = model.fit(
        X_seq_train, y_seq_train,
        validation_data=(X_seq_val, y_seq_val),
        epochs=50,
        batch_size=32,
        class_weight=cw,
        callbacks=callbacks,
        verbose=0,
    )

    epochs_run = len(history.history['loss'])
    val_loss   = min(history.history['val_loss'])
    print(f"      Trained {epochs_run} epochs  |  Best val_loss: {val_loss:.4f}")

    # Save LSTM
    lstm_path = os.path.join(MODELS_DIR, 'lstm_flood_model.keras')
    model.save(lstm_path)
    print(f"      ✅ LSTM model saved → {lstm_path}")
    lstm_trained = True

except ImportError:
    print("      ⚠ TensorFlow not installed — skipping LSTM.")
    print("        Install with: pip install tensorflow")
    lstm_path = None
except Exception as e:
    print(f"      ⚠ LSTM training failed: {e}")
    lstm_path = None

# ── Save metadata ────────────────────────────────────────────
metadata = {
    "model_version"    : "1.0",
    "trained_on"       : pd.Timestamp.now().isoformat(),
    "train_years"      : "2007–2021",
    "val_years"        : "2022–2025",
    "total_rows"       : int(len(df)),
    "flood_days"       : int(df[TARGET].sum()),
    "flood_pct"        : round(float(df[TARGET].mean() * 100), 2),
    "features"         : FEATURES,
    "n_features"       : len(FEATURES),
    "xgboost_params"   : xgb_params,
    "best_threshold"   : round(best_thr, 4),
    "metrics": {
        "auc_roc"      : round(auc, 4),
        "accuracy"     : round(acc, 4),
        "best_f1"      : round(best_f1, 4),
    },
    "smote_used"       : use_smote,
    "scale_pos_weight" : spw,
    "lstm_trained"     : lstm_trained,
    "files": {
        "xgboost"      : xgb_path,
        "lstm"         : lstm_path if lstm_trained else None,
        "scaler"       : os.path.join(MODELS_DIR, 'scaler.pkl'),
        "csv"          : CSV_PATH,
    }
}

meta_path = os.path.join(MODELS_DIR, 'model_metadata.json')
with open(meta_path, 'w') as f:
    json.dump(metadata, f, indent=2)

# ── Summary ──────────────────────────────────────────────────
print("\n" + "=" * 60)
print("✅ TRAINING COMPLETE")
print("=" * 60)
print(f"   XGBoost AUC-ROC : {auc:.4f}")
print(f"   XGBoost F1      : {best_f1:.4f}")
print(f"   XGBoost Acc     : {acc:.4f}")
print(f"   LSTM trained    : {'Yes' if lstm_trained else 'No (install tensorflow)'}")
print(f"\n   Models saved in : {MODELS_DIR}/")
print(f"   Metadata        : {meta_path}")
print("\n✅ Next step: python api.py")
print("   Your FastAPI backend will serve live predictions.")
print("=" * 60)
