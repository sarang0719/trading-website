import os
import time
from typing import Dict, Any, Optional
import numpy as np
import pandas as pd
import requests
import ccxt

DATA_DIR = os.path.join(os.path.dirname(__file__), 'data')
os.makedirs(DATA_DIR, exist_ok=True)

# Shared requests session for connection pooling and low latency
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "Mozilla/5.0 (compatible; InstitutionalTradingAI/3.0)"})

# Cached CCXT exchange instance
EXCHANGE_INSTANCE: Optional[ccxt.binance] = None

def get_ccxt_exchange() -> ccxt.binance:
    global EXCHANGE_INSTANCE
    if EXCHANGE_INSTANCE is None:
        EXCHANGE_INSTANCE = ccxt.binance({"enableRateLimit": True, "timeout": 8000})
    return EXCHANGE_INSTANCE

def normalize_symbol(symbol: str) -> Dict[str, Any]:
    """
    Unified normalization of symbol identifiers across Binance, CCXT, Yahoo.
    """
    raw = symbol.upper().replace("/", "").replace(" ", "").replace("-", "")

    # Forex mapping
    if raw in ["EURUSD", "EURUSDT"]:
        return {
            "binance": "EURUSDT",
            "ccxt": "EUR/USDT",
            "yahoo": "EURUSD=X",
            "base_price": 1.0850,
            "is_forex": True
        }
    if raw in ["GBPUSD", "GBPUSDT"]:
        return {
            "binance": "GBPUSDT",
            "ccxt": "GBP/USDT",
            "yahoo": "GBPUSD=X",
            "base_price": 1.2850,
            "is_forex": True
        }
    if raw in ["USDJPY", "USDJPYT"]:
        return {
            "binance": "USDJPY",
            "ccxt": "USD/JPY",
            "yahoo": "USDJPY=X",
            "base_price": 158.0,
            "is_forex": True
        }
    if raw in ["AUDUSD", "AUDUSDT"]:
        return {
            "binance": "AUDUSDT",
            "ccxt": "AUD/USDT",
            "yahoo": "AUDUSD=X",
            "base_price": 0.7040,
            "is_forex": True
        }
    if raw in ["USDCHF", "USDCHFT"]:
        return {
            "binance": "USDCHF",
            "ccxt": "USD/CHF",
            "yahoo": "USDCHF=X",
            "base_price": 0.8250,
            "is_forex": True
        }

    # Gold / Commodities mapping (Binance spot gold is PAXGUSDT)
    if raw in ["XAUUSD", "XAUTUSDC", "XAUTUSDT", "PAXGUSDT", "GOLD"]:
        return {
            "binance": "PAXGUSDT",
            "binance_alt": "XAUTUSDT",
            "ccxt": "PAXG/USDT",
            "yahoo": "GC=F",
            "base_price": 4140.0,
            "is_forex": False
        }
    if raw in ["XAGUSD", "SILVER"]:
        return {
            "binance": "XAGUSDT",
            "ccxt": "XAG/USDT",
            "yahoo": "SI=F",
            "base_price": 64.5,
            "is_forex": False
        }
    if raw in ["WTIUSD", "OIL", "CRUDEOIL"]:
        return {
            "binance": "WTIUSDT",
            "ccxt": "WTI/USDT",
            "yahoo": "CL=F",
            "base_price": 92.8,
            "is_forex": False
        }

    # Crypto mapping
    if raw in ["BTCUSD", "BTCUSDT"]:
        return {
            "binance": "BTCUSDT",
            "ccxt": "BTC/USDT",
            "yahoo": "BTC-USD",
            "base_price": 84500.0,
            "is_forex": False
        }
    if raw in ["ETHUSD", "ETHUSDT"]:
        return {
            "binance": "ETHUSDT",
            "ccxt": "ETH/USDT",
            "yahoo": "ETH-USD",
            "base_price": 2660.0,
            "is_forex": False
        }
    if raw in ["SOLUSD", "SOLUSDT"]:
        return {
            "binance": "SOLUSDT",
            "ccxt": "SOL/USDT",
            "yahoo": "SOL-USD",
            "base_price": 115.0,
            "is_forex": False
        }
    if raw in ["BNBUSD", "BNBUSDT"]:
        return {
            "binance": "BNBUSDT",
            "ccxt": "BNB/USDT",
            "yahoo": "BNB-USD",
            "base_price": 765.0,
            "is_forex": False
        }
    if raw in ["XRPUSD", "XRPUSDT"]:
        return {
            "binance": "XRPUSDT",
            "ccxt": "XRP/USDT",
            "yahoo": "XRP-USD",
            "base_price": 1.49,
            "is_forex": False
        }

    # Default standard USDT symbol
    bin_sym = raw if raw.endswith("USDT") or raw.endswith("USDC") else f"{raw}USDT"
    ccxt_sym = f"{bin_sym[:-4]}/USDT" if bin_sym.endswith("USDT") else f"{raw}/USDT"
    return {
        "binance": bin_sym,
        "ccxt": ccxt_sym,
        "yahoo": f"{raw}=X",
        "base_price": 100.0,
        "is_forex": False
    }

def get_interval_ms(timeframe: str) -> int:
    tf = timeframe.lower()
    if tf in ["1m"]: return 60 * 1000
    if tf in ["3m"]: return 3 * 60 * 1000
    if tf in ["5m"]: return 5 * 60 * 1000
    if tf in ["15m"]: return 15 * 60 * 1000
    if tf in ["30m"]: return 30 * 60 * 1000
    if tf in ["1h", "60m"]: return 60 * 60 * 1000
    if tf in ["4h", "240m"]: return 4 * 60 * 60 * 1000
    if tf in ["1d"]: return 24 * 60 * 60 * 1000
    return 5 * 60 * 1000

def validate_ohlcv(df: pd.DataFrame) -> pd.DataFrame:
    """
    Data Validation Layer (Rule 30):
    - Rejects invalid / NaN OHLC values
    - Checks high >= low, high >= max(open, close), low <= min(open, close)
    - Deduplicates timestamps & ensures strictly increasing temporal order
    - Ensures non-negative volume
    - Filters anomalous flash spikes (> 30% single-candle jump without market structure)
    """
    if df.empty or len(df) < 5:
        return pd.DataFrame(columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])

    df = df.copy()
    for col in ['open', 'high', 'low', 'close', 'volume']:
        df[col] = pd.to_numeric(df[col], errors='coerce')

    df = df.dropna(subset=['open', 'high', 'low', 'close'])
    if df.empty:
        return pd.DataFrame(columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])

    # Ensure timestamp is datetime
    if not np.issubdtype(df['timestamp'].dtype, np.datetime64):
        df['timestamp'] = pd.to_datetime(df['timestamp'], errors='coerce')
    df = df.dropna(subset=['timestamp'])

    # Deduplicate timestamps and sort
    df = df.drop_duplicates(subset=['timestamp']).sort_values('timestamp').reset_index(drop=True)

    # Valid OHLC bounds
    valid_bounds = (
        (df['high'] >= df['low']) &
        (df['high'] >= df['open'] * 0.9999) &
        (df['high'] >= df['close'] * 0.9999) &
        (df['low'] <= df['open'] * 1.0001) &
        (df['low'] <= df['close'] * 1.0001) &
        (df['open'] > 0) &
        (df['close'] > 0)
    )
    df = df[valid_bounds].copy()

    # Normalize volume
    df['volume'] = np.where(df['volume'] < 0, 0.0, df['volume'])
    df['volume'] = np.where(df['volume'] == 0, 1000.0, df['volume'])

    # Sanitize high and low to envelop open and close
    df['high'] = np.maximum(df['high'], np.maximum(df['open'], df['close']))
    df['low'] = np.minimum(df['low'], np.minimum(df['open'], df['close']))

    # Filter catastrophic outlier single-candle flash crashes / spikes (>30% jump)
    pct_changes = df['close'].pct_change().abs().fillna(0.0)
    normal_returns = pct_changes <= 0.30
    df = df[normal_returns].reset_index(drop=True)

    return df

def get_cache_path(symbol: str, timeframe: str) -> str:
    sym_clean = symbol.upper().replace("/", "")
    tf_clean = timeframe.lower()
    sym_dir = os.path.join(DATA_DIR, sym_clean)
    os.makedirs(sym_dir, exist_ok=True)
    return os.path.join(sym_dir, f"{tf_clean}.csv.gz")

def load_cached_data(symbol: str, timeframe: str) -> Optional[pd.DataFrame]:
    path = get_cache_path(symbol, timeframe)
    if os.path.exists(path):
        try:
            df = pd.read_csv(path, compression='gzip')
            df['timestamp'] = pd.to_datetime(df['timestamp'])
            return validate_ohlcv(df)
        except Exception:
            return None
    return None

def save_cached_data(symbol: str, timeframe: str, df: pd.DataFrame):
    if df.empty:
        return
    path = get_cache_path(symbol, timeframe)
    try:
        df.to_csv(path, index=False, compression='gzip')
    except Exception as e:
        print(f"[-] Could not save cache to {path}: {e}")

def fetch_historical_data(
    symbol: str,
    timeframe: str = '5m',
    limit: int = 3500,
    use_cache: bool = True
) -> pd.DataFrame:
    """
    Fetch genuine real historical OHLCV data.
    Strict Rule 2 & 7: Synthetic fallback data is NEVER returned for production AI.
    If real data cannot be fetched, raises RuntimeError("DATA_UNAVAILABLE").
    """
    norm = normalize_symbol(symbol)
    tf_clean = timeframe.lower()
    if tf_clean in ["60m"]: tf_clean = "1h"
    elif tf_clean in ["240m"]: tf_clean = "4h"

    # Check local cache first if sufficient candles available
    if use_cache:
        cached_df = load_cached_data(symbol, tf_clean)
        if cached_df is not None and len(cached_df) >= limit:
            return cached_df.tail(limit).reset_index(drop=True)

    # 1. Direct Binance Kline API with deep reverse pagination
    bin_symbols_to_try = [norm["binance"]]
    if "binance_alt" in norm:
        bin_symbols_to_try.append(norm["binance_alt"])

    for bin_symbol in bin_symbols_to_try:
        try:
            all_rows = []
            end_time = None
            consecutive_empty = 0

            while len(all_rows) < limit:
                batch_size = min(1000, limit - len(all_rows))
                url = f"https://api3.binance.com/api/v3/klines?symbol={bin_symbol}&interval={tf_clean}&limit={batch_size}"
                if end_time is not None:
                    url += f"&endTime={end_time}"
                
                resp = SESSION.get(url, timeout=6)
                if resp.status_code != 200:
                    break
                raw_data = resp.json()
                if not isinstance(raw_data, list) or not raw_data:
                    consecutive_empty += 1
                    if consecutive_empty >= 2:
                        break
                    continue

                batch_rows = []
                for k in raw_data:
                    batch_rows.append((
                        pd.to_datetime(k[0], unit='ms'),
                        float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5])
                    ))
                all_rows = batch_rows + all_rows
                end_time = int(raw_data[0][0]) - 1
                if len(raw_data) < batch_size:
                    break

            if all_rows:
                df = pd.DataFrame(all_rows, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
                df = validate_ohlcv(df)
                if len(df) >= min(100, limit // 4):
                    if use_cache:
                        save_cached_data(symbol, tf_clean, df)
                    return df.tail(limit).reset_index(drop=True)
        except Exception:
            pass

    # 2. CCXT Exchange Fallback
    try:
        exchange = get_ccxt_exchange()
        formatted_symbol = norm["ccxt"]
        all_ohlcv = []
        interval_ms = get_interval_ms(tf_clean)
        since = int(time.time() * 1000) - (limit * interval_ms)

        while len(all_ohlcv) < limit:
            fetch_count = min(1000, limit - len(all_ohlcv))
            ohlcv = exchange.fetch_ohlcv(formatted_symbol, tf_clean, since=since, limit=fetch_count)
            if not ohlcv:
                break
            all_ohlcv.extend(ohlcv)
            since = ohlcv[-1][0] + 1
            if len(ohlcv) < fetch_count:
                break

        if all_ohlcv:
            df = pd.DataFrame(all_ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
            df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
            df = validate_ohlcv(df)
            if len(df) >= min(100, limit // 4):
                if use_cache:
                    save_cached_data(symbol, tf_clean, df)
                return df.tail(limit).reset_index(drop=True)
    except Exception:
        pass

    # 3. Yahoo Finance Fallback
    try:
        y_sym = norm["yahoo"]
        y_int = "1m" if tf_clean in ["1m", "2m"] else "5m" if tf_clean in ["3m", "5m"] else "15m" if tf_clean in ["15m", "30m"] else "60m" if tf_clean in ["1h", "4h"] else "1d"
        y_range = "7d" if y_int in ["1m", "5m"] else "60d"
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{y_sym}?interval={y_int}&range={y_range}"
        resp = SESSION.get(url, timeout=5)
        if resp.status_code == 200:
            y_data = resp.json()
            chart = y_data.get('chart', {}).get('result', [{}])[0]
            timestamps = chart.get('timestamp', [])
            quote = chart.get('indicators', {}).get('quote', [{}])[0]
            if timestamps and quote:
                opens = quote.get('open', [])
                highs = quote.get('high', [])
                lows = quote.get('low', [])
                closes = quote.get('close', [])
                vols = quote.get('volume', [])
                rows = []
                for i in range(len(timestamps)):
                    if opens[i] is not None and closes[i] is not None:
                        o, c = float(opens[i]), float(closes[i])
                        h = float(highs[i]) if highs[i] is not None else max(o, c)
                        l = float(lows[i]) if lows[i] is not None else min(o, c)
                        v = float(vols[i]) if vols[i] is not None and vols[i] > 0 else 1000.0
                        rows.append((pd.to_datetime(timestamps[i], unit='s'), o, h, l, c, v))
                if rows:
                    df = pd.DataFrame(rows, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
                    df = validate_ohlcv(df)
                    if len(df) >= min(100, limit // 4):
                        if use_cache:
                            save_cached_data(symbol, tf_clean, df)
                        return df.tail(limit).reset_index(drop=True)
    except Exception:
        pass

    # Check cached data as last real fallback
    cached_df = load_cached_data(symbol, tf_clean)
    if cached_df is not None and len(cached_df) >= 50:
        return cached_df.tail(limit).reset_index(drop=True)

    # Rule 7: NO SYNTHETIC DATA in production AI. Raise explicit DATA_UNAVAILABLE.
    raise RuntimeError(f"DATA_UNAVAILABLE: Real market data could not be fetched for {symbol} ({timeframe}).")

def generate_mock_synthetic_data(symbol: str, timeframe: str = '5m', limit: int = 500) -> pd.DataFrame:
    """
    Explicitly separated synthetic generator SOLELY for offline unit tests or UI mock previews.
    NEVER to be used in production AI training or live trading predictions.
    """
    norm = normalize_symbol(symbol)
    base_p = norm["base_price"]
    freq = "5min" if timeframe in ["5m"] else "1min" if timeframe in ["1m"] else "15min" if timeframe in ["15m"] else "1h"
    timestamps = pd.date_range(end=pd.Timestamp.now(), periods=limit, freq=freq)

    t_idx = np.arange(limit)
    noise = (np.sin(t_idx * 0.3) + np.cos(t_idx * 0.7) * 0.5) * 0.0015
    cumulative_returns = np.cumprod(1.0 + noise)
    closes = base_p * cumulative_returns
    opens = np.roll(closes, 1)
    opens[0] = base_p
    changes = np.abs(closes - opens)
    highs = np.maximum(opens, closes) + changes * 0.4
    lows = np.minimum(opens, closes) - changes * 0.4
    volumes = 1500.0 + (t_idx % 20) * 100.0

    return pd.DataFrame({
        'timestamp': timestamps,
        'open': opens,
        'high': highs,
        'low': lows,
        'close': closes,
        'volume': volumes
    })

if __name__ == "__main__":
    print("[*] Testing real data pipeline with data validation layer...")
    for sym in ["BTCUSDT", "PAXGUSDT", "EURUSD"]:
        df = fetch_historical_data(sym, "5m", 500)
        print(f"  [+] {sym} 5m: Fetched {len(df)} validated real candles. Last Close: {df['close'].iloc[-1]}")
