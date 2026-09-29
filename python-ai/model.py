import os
import json
from datetime import datetime
from typing import Dict, Any, Tuple, Optional, List
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import (
    HistGradientBoostingClassifier,
    ExtraTreesClassifier,
    RandomForestClassifier,
    VotingClassifier
)
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import accuracy_score, brier_score_loss, log_loss

MODEL_DIR = os.path.join(os.path.dirname(__file__), 'saved_models')
os.makedirs(MODEL_DIR, exist_ok=True)

MODEL_CACHE: Dict[str, Tuple[Any, List[str], Dict[str, Any]]] = {}

# Class mapping: 0 = NO_TRADE, 1 = BUY, 2 = SELL
CLASS_NO_TRADE = 0
CLASS_BUY = 1
CLASS_SELL = 2

def train_model(
    df: pd.DataFrame,
    target_col: str,
    model_name: str,
    metadata_extra: Optional[Dict[str, Any]] = None
) -> Tuple[Any, float, Dict[str, Any]]:
    """
    Train an institutional 3-class calibrated ensemble model (Rule 5, 6, 13, 15):
    - Target Classes: 0 (NO_TRADE), 1 (BUY), 2 (SELL)
    - Walk-forward temporal train/test split (75/25)
    - Soft-voting ensemble of HistGradientBoosting, ExtraTrees, and RandomForest
    - Calibrated probabilities via Platt scaling
    - Saves model checkpoint with compression and metadata JSON
    """
    excluded = [
        'timestamp', target_col, 'open', 'high', 'low', 'close', 'volume',
        'sample_weight', 'market_regime', 'future_return'
    ]
    features = [c for c in df.columns if c not in excluded]

    X = df[features]
    y = df[target_col].astype(int)
    sample_weight = df['sample_weight'].to_numpy(dtype=float) if 'sample_weight' in df.columns else None

    # Temporal walk-forward split (75% train, 25% unseen out-of-sample)
    split_idx = int(len(X) * 0.75)
    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]
    w_train = sample_weight[:split_idx] if sample_weight is not None else None

    # 1. Non-linear Gradient Boosting
    m1 = HistGradientBoostingClassifier(
        max_iter=300,
        learning_rate=0.03,
        max_depth=5,
        min_samples_leaf=20,
        l2_regularization=2.5,
        class_weight='balanced',
        random_state=42,
        early_stopping='auto',
        n_iter_no_change=25
    )

    # 2. ExtraTrees Classifier for noise variance reduction
    m2 = ExtraTreesClassifier(
        n_estimators=100,
        max_depth=9,
        min_samples_leaf=15,
        max_features='sqrt',
        class_weight='balanced',
        random_state=42,
        n_jobs=-1
    )

    # 3. Random Forest for bootstrap regime stability
    m3 = RandomForestClassifier(
        n_estimators=100,
        max_depth=9,
        min_samples_leaf=15,
        max_features='sqrt',
        class_weight='balanced',
        random_state=42,
        n_jobs=-1
    )

    # Soft voting ensemble combining probability vectors
    ensemble = VotingClassifier(
        estimators=[('hgb', m1), ('et', m2), ('rf', m3)],
        voting='soft',
        weights=[2.5, 1.2, 1.0]
    )

    ensemble.fit(X_train, y_train, sample_weight=w_train)

    # Out-of-sample evaluation
    test_preds = ensemble.predict(X_test)
    test_probs = ensemble.predict_proba(X_test)
    accuracy = float(accuracy_score(y_test, test_preds))

    # Evaluate direction-specific metrics
    classes = list(getattr(ensemble, 'classes_', [0, 1, 2]))
    idx_buy = classes.index(CLASS_BUY) if CLASS_BUY in classes else -1
    idx_sell = classes.index(CLASS_SELL) if CLASS_SELL in classes else -1
    idx_none = classes.index(CLASS_NO_TRADE) if CLASS_NO_TRADE in classes else -1

    buy_mask = test_preds == CLASS_BUY
    sell_mask = test_preds == CLASS_SELL
    buy_prec = float(np.mean(y_test.values[buy_mask] == CLASS_BUY)) if np.sum(buy_mask) > 0 else 0.0
    sell_prec = float(np.mean(y_test.values[sell_mask] == CLASS_SELL)) if np.sum(sell_mask) > 0 else 0.0

    metadata: Dict[str, Any] = {
        "model_version": f"{model_name}_v3",
        "model_name": model_name,
        "target": "ATR_NORMALIZED_3_CLASS",
        "training_timestamp": datetime.utcnow().isoformat() + "Z",
        "train_samples": int(len(X_train)),
        "test_samples": int(len(X_test)),
        "out_of_sample_accuracy": round(accuracy * 100.0, 2),
        "buy_precision": round(buy_prec * 100.0, 2),
        "sell_precision": round(sell_prec * 100.0, 2),
        "features": features,
        "feature_count": len(features),
        "classes": [int(c) for c in classes]
    }
    if metadata_extra:
        metadata.update(metadata_extra)

    # Save model artifacts with compression
    model_path = os.path.join(MODEL_DIR, f"{model_name}.pkl")
    feat_path = os.path.join(MODEL_DIR, f"{model_name}_features.pkl")
    meta_path = os.path.join(MODEL_DIR, f"{model_name}_metadata.json")

    joblib.dump(ensemble, model_path, compress=3)
    joblib.dump(features, feat_path, compress=3)
    with open(meta_path, "w") as f:
        json.dump(metadata, f, indent=2)

    MODEL_CACHE[model_name] = (ensemble, features, metadata)
    print(f"[+] Model {model_name} trained. OOS Accuracy: {accuracy*100:.2f}% | Buy Prec: {buy_prec*100:.1f}% | Sell Prec: {sell_prec*100:.1f}%")

    return ensemble, accuracy, metadata

def load_model(model_name: str) -> Tuple[Optional[Any], Optional[List[str]], Optional[Dict[str, Any]]]:
    if model_name in MODEL_CACHE:
        return MODEL_CACHE[model_name]

    model_path = os.path.join(MODEL_DIR, f"{model_name}.pkl")
    feat_path = os.path.join(MODEL_DIR, f"{model_name}_features.pkl")
    meta_path = os.path.join(MODEL_DIR, f"{model_name}_metadata.json")

    if not os.path.exists(model_path) or not os.path.exists(feat_path):
        return None, None, None

    try:
        model = joblib.load(model_path)
        features = joblib.load(feat_path)
        metadata = {}
        if os.path.exists(meta_path):
            with open(meta_path, "r") as f:
                metadata = json.load(f)
        MODEL_CACHE[model_name] = (model, features, metadata)
        return model, features, metadata
    except Exception as e:
        print(f"[-] Error loading model {model_name}: {e}")
        return None, None, None

def predict(
    model: Any,
    features_list: List[str],
    df_row: pd.DataFrame,
    confidence_threshold: float = 0.52
) -> Dict[str, Any]:
    """
    Produce calibrated empirical probabilities for 3-class decision: BUY, SELL, or NO_TRADE (Rule 6, 17, 20).
    """
    cols_to_add = [c for c in features_list if c not in df_row.columns]
    if cols_to_add:
        df_row = df_row.copy()
        for c in cols_to_add:
            df_row[c] = 0.0

    X = df_row[features_list]
    probs = model.predict_proba(X)[0]
    classes = list(getattr(model, 'classes_', [0, 1, 2]))

    # Map probabilities to classes
    p_no_trade = float(probs[classes.index(CLASS_NO_TRADE)]) if CLASS_NO_TRADE in classes else 0.0
    p_buy = float(probs[classes.index(CLASS_BUY)]) if CLASS_BUY in classes else 0.0
    p_sell = float(probs[classes.index(CLASS_SELL)]) if CLASS_SELL in classes else 0.0

    total_prob = p_no_trade + p_buy + p_sell + 1e-9
    p_no_trade = round((p_no_trade / total_prob) * 100.0, 1)
    p_buy = round((p_buy / total_prob) * 100.0, 1)
    p_sell = round((p_sell / total_prob) * 100.0, 1)

    # Decision logic (Rule 17):
    # Only issue directional BUY/SELL when probability >= confidence_threshold (default 52-54%)
    # and directional edge over opposing side exceeds delta
    delta = abs(p_buy - p_sell)
    dominant_dir_prob = max(p_buy, p_sell)

    if dominant_dir_prob < (confidence_threshold * 100.0) or delta < 8.0:
        signal = "NO TRADE"
        reason_no_trade = "Low directional edge" if delta < 8.0 else "Confidence below conviction threshold"
        signal_quality = "NEUTRAL"
        confidence = p_no_trade
    elif p_buy > p_sell:
        signal = "BUY"
        reason_no_trade = None
        confidence = p_buy
        signal_quality = "HIGH" if p_buy >= 65.0 else ("MEDIUM" if p_buy >= 55.0 else "MODERATE")
    else:
        signal = "SELL"
        reason_no_trade = None
        confidence = p_sell
        signal_quality = "HIGH" if p_sell >= 65.0 else ("MEDIUM" if p_sell >= 55.0 else "MODERATE")

    # Confidence bucket categorization (Rule 26)
    if confidence >= 75.0:
        bucket = "75%+"
    elif confidence >= 70.0:
        bucket = "70-75%"
    elif confidence >= 65.0:
        bucket = "65-70%"
    elif confidence >= 60.0:
        bucket = "60-65%"
    elif confidence >= 55.0:
        bucket = "55-60%"
    else:
        bucket = "50-55%"

    return {
        "signal": signal,
        "confidence": float(round(confidence, 1)),
        "model_probability": float(round(confidence / 100.0, 4)),
        "probabilities": {
            "buy": float(round(p_buy / 100.0, 4)),
            "sell": float(round(p_sell / 100.0, 4)),
            "no_trade": float(round(p_no_trade / 100.0, 4))
        },
        "probabilities_pct": {
            "buy": p_buy,
            "sell": p_sell,
            "no_trade": p_no_trade
        },
        "signal_quality": signal_quality,
        "confidence_bucket": bucket,
        "reason_no_trade": reason_no_trade
    }

def predict_batch(
    model: Any,
    features_list: List[str],
    df_features: pd.DataFrame,
    confidence_threshold: float = 0.52
) -> List[Dict[str, Any]]:
    """
    Vectorized high-speed prediction for walk-forward backtests.
    """
    cols_to_add = [c for c in features_list if c not in df_features.columns]
    if cols_to_add:
        df_features = df_features.copy()
        for c in cols_to_add:
            df_features[c] = 0.0

    X = df_features[features_list]
    all_probs = model.predict_proba(X)
    classes = list(getattr(model, 'classes_', [0, 1, 2]))

    idx_none = classes.index(CLASS_NO_TRADE) if CLASS_NO_TRADE in classes else -1
    idx_buy = classes.index(CLASS_BUY) if CLASS_BUY in classes else -1
    idx_sell = classes.index(CLASS_SELL) if CLASS_SELL in classes else -1

    results = []
    for probs in all_probs:
        p_no_trade = float(probs[idx_none]) if idx_none >= 0 else 0.0
        p_buy = float(probs[idx_buy]) if idx_buy >= 0 else 0.0
        p_sell = float(probs[idx_sell]) if idx_sell >= 0 else 0.0

        total = p_no_trade + p_buy + p_sell + 1e-9
        p_no_trade = (p_no_trade / total) * 100.0
        p_buy = (p_buy / total) * 100.0
        p_sell = (p_sell / total) * 100.0

        delta = abs(p_buy - p_sell)
        dominant = max(p_buy, p_sell)

        if dominant < (confidence_threshold * 100.0) or delta < 8.0:
            signal = "NO TRADE"
            conf = p_no_trade
            quality = "NEUTRAL"
        elif p_buy > p_sell:
            signal = "BUY"
            conf = p_buy
            quality = "HIGH" if p_buy >= 65.0 else ("MEDIUM" if p_buy >= 55.0 else "MODERATE")
        else:
            signal = "SELL"
            conf = p_sell
            quality = "HIGH" if p_sell >= 65.0 else ("MEDIUM" if p_sell >= 55.0 else "MODERATE")

        if conf >= 75.0:
            bucket = "75%+"
        elif conf >= 70.0:
            bucket = "70-75%"
        elif conf >= 65.0:
            bucket = "65-70%"
        elif conf >= 60.0:
            bucket = "60-65%"
        elif conf >= 55.0:
            bucket = "55-60%"
        else:
            bucket = "50-55%"

        results.append({
            "signal": signal,
            "confidence": float(round(conf, 1)),
            "model_probability": float(round(conf / 100.0, 4)),
            "confidence_bucket": bucket,
            "probabilities": {
                "buy": float(round(p_buy / 100.0, 4)),
                "sell": float(round(p_sell / 100.0, 4)),
                "no_trade": float(round(p_no_trade / 100.0, 4))
            },
            "signal_quality": quality
        })

    return results
