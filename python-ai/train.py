import os
from typing import Optional, Any
import pandas as pd
import numpy as np
from dataset import fetch_historical_data
from feature_engine import generate_features
from model import train_model

def prepare_target(df: pd.DataFrame, k_factor: float = 0.20) -> pd.DataFrame:
    """
    3-Class Target Formulation (Rule 5 & 6):
    - Future Return: (next_close - current_close) / current_close
    - Dynamic ATR Threshold: k * (ATR / current_close)
    - Target:
        1 = BUY       (future_return > threshold)
        2 = SELL      (future_return < -threshold)
        0 = NO_TRADE  (abs(future_return) <= threshold)
    - Sample weights emphasize decisive moves beyond threshold over low-volume chop.
    """
    df = df.copy()
    next_close = df['close'].shift(-1)
    curr_close = df['close']

    future_return = (next_close - curr_close) / curr_close
    atr = df['ATR'] if 'ATR' in df.columns else (df['high'] - df['low'])
    atr_pct = atr / np.maximum(curr_close, 1e-6)
    threshold = np.maximum(k_factor * atr_pct, 0.0001)

    conditions = [
        future_return > threshold,
        future_return < -threshold
    ]
    choices = [1, 2]  # 1 = BUY, 2 = SELL
    df['target'] = np.select(conditions, choices, default=0)  # 0 = NO_TRADE
    df['future_return'] = future_return

    # Sample weight scales with expansion conviction
    df['sample_weight'] = np.clip(np.abs(future_return) / threshold, 0.5, 3.5)
    df = df.iloc[:-1].reset_index(drop=True)
    return df

def run_training(
    symbol: str,
    timeframe: str = '5m',
    limit: int = 3500,
    k_factor: float = 0.20
) -> Optional[Any]:
    print(f"\n=================================================================")
    print(f"  Training Canonical 3-Class AI Model: {symbol} ({timeframe})")
    print(f"=================================================================")
    try:
        df = fetch_historical_data(symbol, timeframe, limit=limit)
    except Exception as err:
        print(f"[-] Could not fetch data for {symbol} ({timeframe}): {err}")
        return None

    if df.empty or len(df) < 150:
        print(f"[-] Insufficient real data for {symbol} ({timeframe}): {len(df)} candles.")
        return None

    print(f"[*] Fetched {len(df)} real market candles. Generating ATR-normalized features & regimes...")
    df_feat = generate_features(df, drop_warmup=True)
    df_prepared = prepare_target(df_feat, k_factor=k_factor)

    class_dist = df_prepared['target'].value_counts().to_dict()
    print(f"[*] Target distribution (0=NO_TRADE, 1=BUY, 2=SELL): {class_dist}")

    model_name = f"{symbol}_{timeframe}"
    metadata_extra = {
        "symbol": symbol,
        "timeframe": timeframe,
        "k_factor": k_factor,
        "dataset_rows": len(df_prepared)
    }

    model, acc, metadata = train_model(df_prepared, 'target', model_name, metadata_extra=metadata_extra)
    print(f"[+] Successfully trained & calibrated {model_name}. Out-of-sample accuracy: {acc * 100:.2f}%\n")
    return model

if __name__ == "__main__":
    markets = ["BTCUSDT", "PAXGUSDT", "EURUSD", "GBPUSD", "ETHUSDT"]
    timeframes = ["5m", "15m", "1h", "1m"]

    for m in markets:
        for tf in timeframes:
            try:
                run_training(m, tf, limit=3500)
            except Exception as e:
                print(f"[-] Error training {m}_{tf}: {e}")
