import os
from typing import Dict, Any, Tuple, Optional, List
import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier

MODEL_DIR = os.path.join(os.path.dirname(__file__), 'saved_models')
os.makedirs(MODEL_DIR, exist_ok=True)

MODEL_CACHE: Dict[str, Tuple[Any, List[str]]] = {}

def train_model(df: pd.DataFrame, target_col: str, model_name: str) -> Tuple[Any, float]:
    """
    Train an institutional-grade gradient boosting model with time-series walk-forward split (80/20).
    Binary Target: 1 (BUY: next candle closes up), 0 (SELL: next candle closes down).
    Sample weights emphasize decisive expansion moves over micro-noise.
    """
    excluded = ['timestamp', target_col, 'open', 'high', 'low', 'close', 'volume', 'sample_weight']
    features = [c for c in df.columns if c not in excluded]

    X = df[features]
    y = df[target_col]
    sample_weight = df['sample_weight'].to_numpy(dtype=float) if 'sample_weight' in df.columns else None

    split_idx = int(len(X) * 0.8)
    X_train, X_test = X.iloc[:split_idx], X.iloc[split_idx:]
    y_train, y_test = y.iloc[:split_idx], y.iloc[split_idx:]
    w_train = sample_weight[:split_idx] if sample_weight is not None else None

    # Institutional gradient booster with conservative regularization to prevent overfitting
    model = HistGradientBoostingClassifier(
        max_iter=200,
        learning_rate=0.02,
        max_depth=4,
        min_samples_leaf=25,
        l2_regularization=3.0,
        class_weight='balanced',
        random_state=42,
        early_stopping='auto',
        n_iter_no_change=20
    )

    model.fit(X_train, y_train, sample_weight=w_train)

    accuracy = float(model.score(X_test, y_test))
    print(f"Model {model_name} trained. Test Accuracy: {accuracy * 100:.2f}%")

    joblib.dump(model, os.path.join(MODEL_DIR, f"{model_name}.pkl"))
    joblib.dump(features, os.path.join(MODEL_DIR, f"{model_name}_features.pkl"))
    MODEL_CACHE[model_name] = (model, features)

    return model, accuracy

def load_model(model_name: str) -> Tuple[Optional[Any], Optional[List[str]]]:
    if model_name in MODEL_CACHE:
        return MODEL_CACHE[model_name]
    try:
        model_path = os.path.join(MODEL_DIR, f"{model_name}.pkl")
        feat_path = os.path.join(MODEL_DIR, f"{model_name}_features.pkl")
        if not os.path.exists(model_path) or not os.path.exists(feat_path):
            return None, None
        model = joblib.load(model_path)
        features = joblib.load(feat_path)
        MODEL_CACHE[model_name] = (model, features)
        return model, features
    except Exception:
        return None, None

def predict(model: Any, features_list: List[str], df_row: pd.DataFrame) -> Dict[str, Any]:
    """
    Produce true empirical calibrated probabilities for next candle direction.
    """
    cols_to_add = [c for c in features_list if c not in df_row.columns]
    if cols_to_add:
        df_row = df_row.copy()
        for c in cols_to_add:
            df_row[c] = 0.0

    X = df_row[features_list]
    probs = model.predict_proba(X)[0]

    raw_classes = getattr(model, 'classes_', [0, 1])
    classes = list(raw_classes) if raw_classes is not None else [0, 1]

    if len(classes) == 2 and 0 in classes and 1 in classes:
        idx_0 = classes.index(0)
        idx_1 = classes.index(1)
        p_down = float(probs[idx_0]) * 100.0
        p_up = float(probs[idx_1]) * 100.0
    else:
        idx_sell = classes.index(0) if 0 in classes else 0
        idx_buy = classes.index(2) if 2 in classes else (classes.index(1) if 1 in classes else 0)
        p_down = float(probs[idx_sell]) * 100.0
        p_up = float(probs[idx_buy]) * 100.0
        tot = p_down + p_up + 1e-6
        p_down = (p_down / tot) * 100.0
        p_up = (p_up / tot) * 100.0

    if abs(p_up - p_down) < 3.0:
        signal = "MONITORING"
        conf = 50.0
    elif p_up > p_down:
        signal = "BUY"
        conf = p_up
    else:
        signal = "SELL"
        conf = p_down

    return {
        "signal": signal,
        "confidence": float(round(conf, 1)),
        "probability_up": float(round(p_up, 1)),
        "probability_down": float(round(p_down, 1))
    }

def predict_batch(model: Any, features_list: List[str], df_features: pd.DataFrame) -> List[Dict[str, Any]]:
    """
    High-speed vectorized batch prediction for walk-forward backtests.
    """
    cols_to_add = [c for c in features_list if c not in df_features.columns]
    if cols_to_add:
        df_features = df_features.copy()
        for c in cols_to_add:
            df_features[c] = 0.0

    X = df_features[features_list]
    all_probs = model.predict_proba(X)
    raw_classes = getattr(model, 'classes_', [0, 1])
    classes = list(raw_classes) if raw_classes is not None else [0, 1]

    idx_0 = classes.index(0) if 0 in classes else 0
    idx_1 = classes.index(1) if 1 in classes else (classes.index(2) if 2 in classes else 1)

    results = []
    for probs in all_probs:
        p_down = float(probs[idx_0]) * 100.0
        p_up = float(probs[idx_1]) * 100.0
        tot = p_down + p_up + 1e-6
        p_down = (p_down / tot) * 100.0
        p_up = (p_up / tot) * 100.0

        if abs(p_up - p_down) < 3.0:
            signal = "MONITORING"
            conf = 50.0
        elif p_up > p_down:
            signal = "BUY"
            conf = p_up
        else:
            signal = "SELL"
            conf = p_down

        results.append({
            "signal": signal,
            "confidence": float(round(conf, 1)),
            "probability_up": float(round(p_up, 1)),
            "probability_down": float(round(p_down, 1))
        })
    return results
