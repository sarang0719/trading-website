import pandas as pd
import numpy as np
from dataset import fetch_historical_data
from feature_engine import generate_features
from model import train_model

def prepare_target(df: pd.DataFrame) -> pd.DataFrame:
    """
    Target: Predict true next-candle directional movement.
    1 = BUY (next close >= current close)
    0 = SELL (next close < current close)
    """
    df = df.copy()
    next_close = df['close'].shift(-1)
    curr_close = df['close']

    atr = df['ATR'] if 'ATR' in df.columns else (df['high'] - df['low'])
    next_move = next_close - curr_close

    df['target'] = (next_move >= 0).astype(int)
    # Weight decisive breakouts proportionally higher than micro-noise
    df['sample_weight'] = np.clip(np.abs(next_move) / np.maximum(atr * 0.35, 1e-6), 0.5, 3.0)
    df = df.iloc[:-1].reset_index(drop=True)
    return df

def run_training(symbol: str, timeframe: str = '5m', limit: int = 1500):
    print(f"--- Training Calibrated Institutional Model for {symbol} ({timeframe}) ---")
    df = fetch_historical_data(symbol, timeframe, limit=limit)
    if df.empty or len(df) < 50:
        print(f"Insufficient data fetched for {symbol} ({timeframe}).")
        return None

    df = generate_features(df)
    df = prepare_target(df)

    model_name = f"{symbol}_{timeframe}"
    model, acc = train_model(df, 'target', model_name)
    print(f"Training complete for {model_name}. Test Accuracy: {acc * 100:.2f}%\n")
    return model

if __name__ == "__main__":
    markets = ["BTCUSDT", "ETHUSDT", "EURUSD", "GBPUSD", "XAUTUSDT"]
    timeframes = ["5m", "15m", "1h"]

    for m in markets:
        for tf in timeframes:
            try:
                run_training(m, tf, limit=1500)
            except Exception as e:
                print(f"Skipping {m}_{tf}: {e}")
