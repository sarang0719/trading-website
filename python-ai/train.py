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
    Sample weights emphasize decisive expansion moves and structural trend breakouts over micro-noise.
    """
    df = df.copy()
    next_close = df['close'].shift(-1)
    curr_close = df['close']

    atr = df['ATR'] if 'ATR' in df.columns else (df['high'] - df['low'])
    next_move = next_close - curr_close

    df['target'] = (next_move >= 0).astype(int)
    # Weight decisive breakouts and structural trend moves proportionally higher than micro-noise
    df['sample_weight'] = np.clip(np.abs(next_move) / np.maximum(atr * 0.25, 1e-6), 0.5, 3.5)
    df = df.iloc[:-1].reset_index(drop=True)
    return df

def run_training(symbol: str, timeframe: str = '15m', limit: int = 3500):
    print(f"\n=================================================================")
    print(f"  Training Institutional Ensemble AI Model: {symbol} ({timeframe})")
    print(f"=================================================================")
    df = fetch_historical_data(symbol, timeframe, limit=limit)
    if df.empty or len(df) < 150:
        print(f"[-] Insufficient data fetched for {symbol} ({timeframe}): {len(df)} candles.")
        return None

    print(f"[*] Fetched {len(df)} historical candles. Generating 91 institutional features...")
    df = generate_features(df)
    df = prepare_target(df)

    model_name = f"{symbol}_{timeframe}"
    model, acc = train_model(df, 'target', model_name)
    print(f"[+] Training complete for {model_name}. Out-Of-Sample Accuracy: {acc * 100:.2f}%\n")
    return model

if __name__ == "__main__":
    markets = ["BTCUSDT", "ETHUSDT", "EURUSD", "GBPUSD", "XAUTUSDT"]
    timeframes = ["15m", "5m", "1h", "1m", "4h"]

    for m in markets:
        for tf in timeframes:
            try:
                run_training(m, tf, limit=3500)
            except Exception as e:
                print(f"[-] Error training {m}_{tf}: {e}")
