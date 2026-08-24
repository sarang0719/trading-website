import pandas as pd
import numpy as np
import os
from dataset import fetch_historical_data
from feature_engine import generate_features
from train import prepare_target, run_training
from model import load_model, predict

def run_walk_forward_backtest(symbol: str, timeframe: str = '5m', test_candles: int = 2000):
    print(f"\n=======================================================")
    print(f"  WALK-FORWARD AI BACKTEST: {symbol} ({timeframe})")
    print(f"=======================================================")
    
    # 1. Ensure fresh model training
    run_training(symbol, timeframe)
    
    # 2. Fetch fresh extended historical candles for testing
    df_raw = fetch_historical_data(symbol, timeframe, limit=test_candles)
    if df_raw.empty or len(df_raw) < 300:
        print(f"[-] Insufficient data for {symbol} ({timeframe}) backtest.")
        return None

    df_feat = generate_features(df_raw)
    model_name = f"{symbol}_{timeframe}"
    model, features = load_model(model_name)
    
    if not model or not features:
        print(f"[-] Model {model_name} could not be loaded.")
        return None
        
    wins = 0
    losses = 0
    no_trade_skips = 0
    total_evaluated = 0
    
    strong_wins = 0
    strong_losses = 0
    
    # Walk forward bar by bar
    start_idx = len(df_feat) - 800 if len(df_feat) > 800 else 100
    
    for i in range(start_idx, len(df_feat) - 1):
        row = df_feat.iloc[[i]]
        next_row = df_feat.iloc[i + 1]
        
        res = predict(model, features, row)
        signal = res['signal']
        conf = res['confidence']
        
        if signal == "NO TRADE":
            no_trade_skips += 1
            continue
            
        actual_move = next_row['close'] - row['close'].values[0]
        actual_direction = "BUY" if actual_move > 0 else "SELL" if actual_move < 0 else "FLAT"
        
        if actual_direction == "FLAT":
            continue
            
        total_evaluated += 1
        is_win = (signal == actual_direction)
        
        if is_win:
            wins += 1
            if conf >= 70:
                strong_wins += 1
        else:
            losses += 1
            if conf >= 70:
                strong_losses += 1

    win_rate = (wins / total_evaluated * 100) if total_evaluated > 0 else 0.0
    strong_sample = strong_wins + strong_losses
    strong_win_rate = (strong_wins / strong_sample * 100) if strong_sample > 0 else 0.0

    print(f"\n  [RESULTS SUMMARY FOR {symbol} {timeframe}]")
    print(f"  • Total Candles Tested: {len(df_feat)}")
    print(f"  • Active Trade Signals Evaluated: {total_evaluated}")
    print(f"  • Low-Probability Noise Filtered: {no_trade_skips}")
    print(f"  • Total Wins: {wins} | Losses: {losses}")
    print(f"  • Overall Model Accuracy / Win Rate: {win_rate:.2f}%")
    print(f"  • High-Confidence (>70% prob) Win Rate: {strong_win_rate:.2f}% ({strong_wins}/{strong_sample})")
    print(f"=======================================================\n")
    
    return {
        "symbol": symbol,
        "timeframe": timeframe,
        "accuracy": round(win_rate, 2),
        "strong_accuracy": round(strong_win_rate, 2),
        "total_trades": total_evaluated,
        "wins": wins,
        "losses": losses
    }

if __name__ == "__main__":
    results = []
    test_markets = [("BTCUSDT", "5m"), ("XAUTUSDT", "5m"), ("ETHUSDT", "15m"), ("EURUSD", "15m")]
    
    for symbol, tf in test_markets:
        try:
            res = run_walk_forward_backtest(symbol, tf, test_candles=2500)
            if res:
                results.append(res)
        except Exception as e:
            print(f"Backtest error on {symbol} {tf}: {e}")

    print("\n" + "█"*60)
    print("      FINAL AGGREGATE AI ACCURACY & WIN RATE REPORT")
    print("█"*60)
    for r in results:
        print(f"  Symbol: {r['symbol']:<10} | TF: {r['timeframe']:<4} | Accuracy: {r['accuracy']}% | High-Conf Accuracy: {r['strong_accuracy']}% | Trades: {r['total_trades']}")
    print("█"*60 + "\n")
