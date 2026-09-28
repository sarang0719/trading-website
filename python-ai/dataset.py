import time
from typing import Dict, Any, Optional
import numpy as np
import pandas as pd
import requests
import ccxt

# Shared requests session for connection pooling and low latency
SESSION = requests.Session()
SESSION.headers.update({"User-Agent": "Mozilla/5.0 (compatible; InstitutionalTradingAI/2.0)"})

# Cached CCXT exchange instance
EXCHANGE_INSTANCE: Optional[ccxt.binance] = None

def get_ccxt_exchange() -> ccxt.binance:
    global EXCHANGE_INSTANCE
    if EXCHANGE_INSTANCE is None:
        EXCHANGE_INSTANCE = ccxt.binance({"enableRateLimit": True, "timeout": 8000})
    return EXCHANGE_INSTANCE

def normalize_symbol(symbol: str) -> Dict[str, Any]:
    """
    Unified normalization of symbol identifiers across Binance, CCXT, Yahoo, and synthetic fallbacks.
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

    # Gold / Commodities mapping
    if raw in ["XAUUSD", "XAUTUSDC", "XAUTUSDT", "PAXGUSDT", "GOLD"]:
        return {
            "binance": "XAUTUSDT",
            "ccxt": "PAXG/USDT",
            "yahoo": "GC=F",
            "base_price": 4280.0,
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

def fetch_historical_data(symbol: str, timeframe: str = '5m', limit: int = 1000) -> pd.DataFrame:
    """
    Fetch historical OHLCV data using direct Binance API with pagination,
    falling back to CCXT, Yahoo Finance, or high-performance synthetic data.
    """
    norm = normalize_symbol(symbol)
    tf_clean = timeframe.lower()
    if tf_clean in ["60m"]: tf_clean = "1h"
    elif tf_clean in ["240m"]: tf_clean = "4h"

    # 1. Direct Binance Kline API (Ultra-Fast with Reverse Pagination)
    try:
        bin_symbol = norm["binance"]
        all_rows = []
        batch_limit = min(limit, 1000)

        if limit <= 1000:
            url = f"https://api3.binance.com/api/v3/klines?symbol={bin_symbol}&interval={tf_clean}&limit={batch_limit}"
            resp = SESSION.get(url, timeout=4)
            if resp.status_code == 200:
                raw_data = resp.json()
                if isinstance(raw_data, list) and raw_data:
                    for k in raw_data:
                        all_rows.append((pd.to_datetime(k[0], unit='ms'), float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5])))
        else:
            # High-performance reverse pagination from current time backwards
            end_time = None
            while len(all_rows) < limit:
                batch_size = min(1000, limit - len(all_rows))
                url = f"https://api3.binance.com/api/v3/klines?symbol={bin_symbol}&interval={tf_clean}&limit={batch_size}"
                if end_time is not None:
                    url += f"&endTime={end_time}"
                resp = SESSION.get(url, timeout=5)
                if resp.status_code != 200:
                    break
                raw_data = resp.json()
                if not isinstance(raw_data, list) or not raw_data:
                    break
                batch_rows = []
                for k in raw_data:
                    batch_rows.append((pd.to_datetime(k[0], unit='ms'), float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5])))
                all_rows = batch_rows + all_rows
                end_time = int(raw_data[0][0]) - 1
                if len(raw_data) < batch_size:
                    break

        if all_rows:
            df = pd.DataFrame(all_rows, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
            df.drop_duplicates(subset=['timestamp'], inplace=True)
            return df.tail(limit).reset_index(drop=True)
    except Exception as bin_err:
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
            df.drop_duplicates(subset=['timestamp'], inplace=True)
            for col in ['open', 'high', 'low', 'close', 'volume']:
                df[col] = pd.to_numeric(df[col], errors='coerce')
            return df.tail(limit).reset_index(drop=True)
    except Exception as ccxt_err:
        pass

    # 3. Yahoo Finance Fallback
    try:
        y_sym = norm["yahoo"]
        y_int = "1m" if tf_clean in ["1m", "2m"] else "5m" if tf_clean in ["3m", "5m"] else "15m" if tf_clean in ["15m", "30m"] else "60m" if tf_clean in ["1h", "4h"] else "1d"
        y_range = "5d" if y_int in ["1m", "5m"] else "1mo"
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{y_sym}?interval={y_int}&range={y_range}"
        resp = SESSION.get(url, timeout=4)
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
                    return df.tail(limit).reset_index(drop=True)
    except Exception:
        pass

    # 4. Ultra-Fast Vectorized Synthetic Fallback (Calibration / Offline Mode)
    base_p = norm["base_price"]
    freq = "5min" if tf_clean in ["5m"] else "1min" if tf_clean in ["1m"] else "15min" if tf_clean in ["15m"] else "1h"
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

    df = pd.DataFrame({
        'timestamp': timestamps,
        'open': opens,
        'high': highs,
        'low': lows,
        'close': closes,
        'volume': volumes
    })
    return df

if __name__ == "__main__":
    df = fetch_historical_data("BTCUSDT", "5m", 100)
    print(f"Fetched {len(df)} candles for BTCUSDT:")
    print(df.tail())
