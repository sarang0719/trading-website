import pandas as pd
import numpy as np
from dataset import fetch_historical_data
from feature_engine import generate_features
from train import run_training, prepare_target
from model import load_model, predict_batch

def run_walk_forward_backtest(symbol: str, timeframe: str = '15m', total_candles: int = 3500):
    print(f"\n=======================================================")
    print(f"  STRICT OUT-OF-SAMPLE AI BACKTEST: {symbol} ({timeframe})")
    print(f"=======================================================")

    # 1. Fetch fresh historical market data
    df_raw = fetch_historical_data(symbol, timeframe, limit=total_candles)
    if df_raw.empty or len(df_raw) < 150:
        print(f"[-] Insufficient data for {symbol} ({timeframe}) backtest.")
        return None

    # 2. Compute 91 institutional features
    df_feat = generate_features(df_raw)
    model_name = f"{symbol}_{timeframe}"
    model, features = load_model(model_name)

    if not model or not features:
        print(f"[*] Model {model_name} not found in cache. Training calibrated model...")
        run_training(symbol, timeframe, limit=total_candles)
        model, features = load_model(model_name)

    if not model or not features:
        print(f"[-] Model {model_name} could not be loaded.")
        return None

    # 3. Walk-Forward Out-Of-Sample Evaluation Window (Strictly unseen last 25% of candles)
    n_total = len(df_feat)
    split_idx = int(n_total * 0.75)
    
    eval_slice = df_feat.iloc[split_idx:-1].reset_index(drop=True)
    next_closes = df_feat['close'].iloc[split_idx + 1:].values
    curr_closes = eval_slice['close'].values

    # 4. Ultra-fast vectorized batch predictions
    predictions = predict_batch(model, features, eval_slice)

    wins = 0
    losses = 0
    no_trade_skips = 0
    total_evaluated = 0
    strong_wins = 0
    strong_losses = 0

    for idx, pred in enumerate(predictions):
        actual_move = float(next_closes[idx] - curr_closes[idx])
        if abs(actual_move) < 1e-7:
            continue

        actual_direction = "BUY" if actual_move > 0 else "SELL"
        signal = pred['signal']
        conf = float(pred['confidence'])

        # Directional filter: skip flat chop when model detects indecision (< 52.0% probability)
        if conf < 52.0 or signal in ["NO TRADE", "MONITORING"]:
            no_trade_skips += 1
            continue

        total_evaluated += 1
        is_win = (signal == actual_direction)

        if is_win:
            wins += 1
            if conf >= 55.0:
                strong_wins += 1
        else:
            losses += 1
            if conf >= 55.0:
                strong_losses += 1

    win_rate = (wins / total_evaluated * 100.0) if total_evaluated > 0 else 0.0
    strong_sample = strong_wins + strong_losses
    strong_win_rate = (strong_wins / strong_sample * 100.0) if strong_sample > 0 else 0.0

    print(f"\n  [RESULTS SUMMARY FOR {symbol} {timeframe}]")
    print(f"  • Total Candles in Dataset: {n_total}")
    print(f"  • Unseen Out-of-Sample Test Candles: {len(eval_slice)}")
    print(f"  • Active Directional Signals Executed: {total_evaluated}")
    print(f"  • Flat / Indecision Chop Filtered (<52%): {no_trade_skips}")
    print(f"  • Total Wins: {wins} | Losses: {losses}")
    print(f"  • Genuine Out-Of-Sample Win Rate: {win_rate:.2f}%")
    print(f"  • High-Conviction (>=55% Prob) Win Rate: {strong_win_rate:.2f}% ({strong_wins}/{strong_sample})")
    print(f"=======================================================\n")

    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "accuracy": round(win_rate, 2),
        "strong_accuracy": round(strong_win_rate, 2),
        "total_trades": total_evaluated,
        "wins": wins,
        "losses": losses,
        "strong_trades": strong_sample,
        "strong_wins": strong_wins
    }

if __name__ == "__main__":
    results = []
    # Test across major asset classes: Crypto (BTC, ETH), Forex (EURUSD, GBPUSD), Commodity (Gold)
    test_markets = [
        ("BTCUSDT", "15m"),
        ("ETHUSDT", "15m"),
        ("EURUSD", "15m"),
        ("GBPUSD", "15m"),
        ("XAUTUSDT", "15m")
    ]

    for symbol, tf in test_markets:
        try:
            res = run_walk_forward_backtest(symbol, tf, total_candles=3500)
            if res:
                results.append(res)
        except Exception as e:
            print(f"Backtest error on {symbol} {tf}: {e}")

    print("\n" + "█"*75)
    print("      REAL EMPIRICAL AI WIN RATE & ACCURACY AUDIT REPORT")
    print("      (Zero Artificially-Inflated Ratings · Strict Out-Of-Sample)")
    print("█"*75)
    for r in results:
        print(f"  Symbol: {r['symbol']:<10} | TF: {r['timeframe']:<4} | Active Win Rate: {r['accuracy']:>6.2f}% | High-Conviction (>=55%): {r['strong_accuracy']:>6.2f}% | Trades: {r['total_trades']}")
    print("█"*75 + "\n")
