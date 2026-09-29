import os
from typing import Any
import numpy as np
import pandas as pd
import pandas_ta as _ta

ta: Any = _ta

WARMUP_PERIOD = 55  # Exclude warmup rows to guarantee valid indicator lookbacks

def _safe_series(s: Any, fallback: Any) -> pd.Series:
    if s is not None and isinstance(s, pd.Series) and not s.empty:
        return s
    if isinstance(fallback, pd.Series):
        return fallback
    return pd.Series(fallback)

def detect_market_regime(df: pd.DataFrame) -> pd.DataFrame:
    """
    Market Regime Classifier (Rule 11):
    Categorizes the market state into institutional regimes:
    - TREND_UP: Bullish EMA stack + positive slope + ADX >= 22
    - TREND_DOWN: Bearish EMA stack + negative slope + ADX >= 22
    - RANGE: Low ADX (< 20) or flat EMA slopes
    - HIGH_VOLATILITY: ATR Expansion ratio >= 1.6 or BB Width > 80th percentile
    - LOW_VOLATILITY: Inside Bollinger/Keltner Squeeze + Low ATR
    - BREAKOUT: Volume surge + high ATR expansion out of range
    """
    adx = df['ADX'].to_numpy(dtype=float) if 'ADX' in df.columns else np.full(len(df), 25.0)
    ema20_slope = df['EMA_20_Slope'].to_numpy(dtype=float) if 'EMA_20_Slope' in df.columns else np.zeros(len(df))
    ema50_dist = df['Dist_EMA50_ATR'].to_numpy(dtype=float) if 'Dist_EMA50_ATR' in df.columns else np.zeros(len(df))
    atr_exp = df['ATR_Expansion_Ratio'].to_numpy(dtype=float) if 'ATR_Expansion_Ratio' in df.columns else np.ones(len(df))
    in_sqz = df['In_Squeeze'].to_numpy(dtype=float) if 'In_Squeeze' in df.columns else np.zeros(len(df))
    vol_surge = df['Vol_Surge'].to_numpy(dtype=float) if 'Vol_Surge' in df.columns else np.ones(len(df))

    is_trend_up = (adx >= 20.0) & (ema20_slope > 0.0) & (ema50_dist > 0.2)
    is_trend_down = (adx >= 20.0) & (ema20_slope < 0.0) & (ema50_dist < -0.2)
    is_high_vol = (atr_exp >= 1.6) | (vol_surge >= 2.2)
    is_low_vol = (in_sqz == 1.0) & (adx < 20.0)
    is_breakout = (vol_surge >= 1.8) & (atr_exp >= 1.3) & (np.abs(ema20_slope) > 0.0005)
    is_range = (~is_trend_up) & (~is_trend_down) & (~is_breakout)

    df['Regime_Trend_Up'] = is_trend_up.astype(float)
    df['Regime_Trend_Down'] = is_trend_down.astype(float)
    df['Regime_Range'] = is_range.astype(float)
    df['Regime_High_Vol'] = is_high_vol.astype(float)
    df['Regime_Low_Vol'] = is_low_vol.astype(float)
    df['Regime_Breakout'] = is_breakout.astype(float)

    # String categorical regime for human explainability and API
    regimes = []
    for i in range(len(df)):
        if is_breakout[i]:
            regimes.append("BREAKOUT")
        elif is_high_vol[i]:
            regimes.append("HIGH_VOLATILITY")
        elif is_trend_up[i]:
            regimes.append("TREND_UP")
        elif is_trend_down[i]:
            regimes.append("TREND_DOWN")
        elif is_low_vol[i]:
            regimes.append("LOW_VOLATILITY")
        else:
            regimes.append("RANGE")

    df['market_regime'] = regimes
    return df

def generate_features(df: pd.DataFrame, drop_warmup: bool = True) -> pd.DataFrame:
    """
    Institutional Feature Generation Pipeline (Rule 10, 11, 12):
    - Price return features across multiple Fibonacci lags
    - Volatility & ATR normalized structure
    - Trend distances normalized strictly by ATR: (close - EMA) / ATR
    - Market regime indicators
    - ZERO data leakage: NO bfill(), strictly causal rolling windows and ffill().
    """
    if df.empty or len(df) < 15:
        return df

    df = df.copy()
    n_candles = len(df)

    close_series = pd.Series(df['close'], dtype=float)
    high_series = pd.Series(df['high'], dtype=float)
    low_series = pd.Series(df['low'], dtype=float)
    vol_series = pd.Series(df['volume'], dtype=float)
    open_series = pd.Series(df['open'], dtype=float)

    close_np = close_series.to_numpy()
    high_np = high_series.to_numpy()
    low_np = low_series.to_numpy()
    open_np = open_series.to_numpy()
    vol_np = vol_series.to_numpy()

    safe_close = np.where(close_np > 0, close_np, 1.0)

    # ── 1. Exponential Moving Averages ──
    df['EMA_9'] = _safe_series(ta.ema(close_series, length=min(9, n_candles)), close_series)
    df['EMA_20'] = _safe_series(ta.ema(close_series, length=min(20, n_candles)), close_series)
    df['EMA_50'] = _safe_series(ta.ema(close_series, length=min(50, n_candles)), close_series)
    df['EMA_100'] = _safe_series(ta.ema(close_series, length=min(100, n_candles)), close_series)
    df['EMA_200'] = _safe_series(ta.ema(close_series, length=min(200, n_candles)), close_series)

    # ── 2. Volatility & True Range ──
    atr_calc = ta.atr(high_series, low_series, close_series, length=min(14, n_candles))
    atr_series = _safe_series(atr_calc, pd.Series(np.maximum(0.0001, high_np - low_np), index=df.index))
    df['ATR'] = atr_series
    safe_atr = np.maximum(atr_series.to_numpy(dtype=float), 1e-6)

    df['ATR_Pct'] = (atr_series / safe_close) * 100.0
    atr_ma20 = atr_series.rolling(window=20, min_periods=1).mean()
    df['ATR_Expansion_Ratio'] = atr_series / np.maximum(atr_ma20, 1e-6)

    # Rolling Volatilities (Standard deviations of log returns)
    log_ret = np.log(safe_close / np.roll(safe_close, 1))
    log_ret[0] = 0.0
    log_ret_s = pd.Series(log_ret, index=df.index)
    df['volatility_5'] = log_ret_s.rolling(5, min_periods=1).std().fillna(0.0)
    df['volatility_10'] = log_ret_s.rolling(10, min_periods=1).std().fillna(0.0)
    df['volatility_20'] = log_ret_s.rolling(20, min_periods=1).std().fillna(0.0)

    # ── 3. Momentum & Oscillators ──
    rsi_raw = ta.rsi(close_series, length=min(14, n_candles))
    rsi_s = _safe_series(rsi_raw, pd.Series(50.0, index=df.index))
    df['RSI'] = rsi_s
    df['RSI_Norm'] = (rsi_s - 50.0) / 50.0  # -1 to +1

    macd_calc = ta.macd(close_series)
    if macd_calc is not None and isinstance(macd_calc, pd.DataFrame) and not macd_calc.empty:
        df['MACD'] = macd_calc.iloc[:, 0]
        df['MACD_Hist'] = macd_calc.iloc[:, 1]
        df['MACD_Signal'] = macd_calc.iloc[:, 2]
        df['MACD_Hist_ATR'] = df['MACD_Hist'] / safe_atr
    else:
        df['MACD'] = 0.0
        df['MACD_Hist'] = 0.0
        df['MACD_Signal'] = 0.0
        df['MACD_Hist_ATR'] = 0.0

    adx_calc = ta.adx(high_series, low_series, close_series)
    if adx_calc is not None and isinstance(adx_calc, pd.DataFrame) and not adx_calc.empty:
        df['ADX'] = adx_calc.iloc[:, 0]
    else:
        df['ADX'] = 25.0

    cci_calc = ta.cci(high_series, low_series, close_series, length=min(14, n_candles))
    df['CCI'] = _safe_series(cci_calc, pd.Series(0.0, index=df.index)) / 100.0

    # ── 4. Bollinger Bands & Squeeze ──
    bbands = ta.bbands(close_series, length=min(20, n_candles))
    if bbands is not None and isinstance(bbands, pd.DataFrame) and not bbands.empty:
        df['BB_Lower'] = bbands.iloc[:, 0]
        df['BB_Mid'] = bbands.iloc[:, 1]
        df['BB_Upper'] = bbands.iloc[:, 2]
    else:
        df['BB_Lower'] = close_series
        df['BB_Mid'] = close_series
        df['BB_Upper'] = close_series

    bb_mid_np = pd.Series(df['BB_Mid'], dtype=float).to_numpy()
    safe_bb_mid = np.where(bb_mid_np > 0, bb_mid_np, 1.0)
    df['BB_Width'] = (pd.Series(df['BB_Upper'], dtype=float).to_numpy() - pd.Series(df['BB_Lower'], dtype=float).to_numpy()) / safe_bb_mid

    # Keltner Channel for Squeeze detection
    typ_price = (high_np + low_np + close_np) / 3.0
    tp_series = pd.Series(typ_price, index=df.index, dtype=float)
    kc_mid = ta.ema(tp_series, length=min(20, n_candles))
    kc_mid_s = _safe_series(kc_mid, tp_series)
    kc_u = kc_mid_s + (1.5 * atr_series)
    kc_l = kc_mid_s - (1.5 * atr_series)
    df['In_Squeeze'] = ((pd.Series(df['BB_Upper']) < kc_u) & (pd.Series(df['BB_Lower']) > kc_l)).astype(float)

    # ── 5. Candle Anatomy & ATR-Normalized Structure (Rule 10) ──
    body_val = close_np - open_np
    range_val = high_np - low_np
    safe_range = np.maximum(range_val, 1e-6)

    df['body_size'] = body_val
    df['candle_range'] = range_val
    df['body_to_range'] = np.abs(body_val) / safe_range
    df['body_to_atr'] = body_val / safe_atr
    df['range_to_atr'] = range_val / safe_atr

    upper_wick = high_np - np.maximum(open_np, close_np)
    lower_wick = np.minimum(open_np, close_np) - low_np
    df['upper_wick_ratio'] = upper_wick / safe_range
    df['lower_wick_ratio'] = lower_wick / safe_range
    df['wick_asymmetry'] = (lower_wick - upper_wick) / safe_range

    # Close Location Value (CLV: -1 = low of candle, +1 = high of candle)
    df['CLV'] = ((close_np - low_np) - (high_np - close_np)) / safe_range

    # ── 6. Trend Distances Normalized by ATR (Rule 10) ──
    df['Dist_EMA9_ATR'] = (close_series - df['EMA_9']) / safe_atr
    df['Dist_EMA20_ATR'] = (close_series - df['EMA_20']) / safe_atr
    df['Dist_EMA50_ATR'] = (close_series - df['EMA_50']) / safe_atr
    df['Dist_EMA100_ATR'] = (close_series - df['EMA_100']) / safe_atr
    df['Dist_EMA200_ATR'] = (close_series - df['EMA_200']) / safe_atr

    # EMA Slopes (Rate of change of trend)
    ema20_s = pd.Series(df['EMA_20'], dtype=float)
    df['EMA_20_Slope'] = (ema20_s - ema20_s.shift(3).fillna(ema20_s)) / safe_atr
    ema50_s = pd.Series(df['EMA_50'], dtype=float)
    df['EMA_50_Slope'] = (ema50_s - ema50_s.shift(3).fillna(ema50_s)) / safe_atr

    # ── 7. Price Returns Across Fibonacci Lags (Rule 10) ──
    ret1 = close_series.pct_change(1).fillna(0.0)
    df['ret_1'] = ret1
    df['ret_2'] = close_series.pct_change(2).fillna(0.0)
    df['ret_3'] = close_series.pct_change(3).fillna(0.0)
    df['ret_5'] = close_series.pct_change(5).fillna(0.0)
    df['ret_10'] = close_series.pct_change(10).fillna(0.0)
    df['ret_20'] = close_series.pct_change(20).fillna(0.0)
    df['ret_accel'] = ret1 - ret1.shift(1).fillna(0.0)

    # ── 8. Volume Dynamics & OBV Z-Score ──
    vol_ma20 = vol_series.rolling(20, min_periods=1).mean()
    df['Vol_Surge'] = vol_series / np.maximum(vol_ma20, 1e-6)

    obv_step = np.sign(ret1) * vol_series
    obv = obv_step.cumsum()
    obv_ma = obv.rolling(20, min_periods=1).mean()
    obv_std = obv.rolling(20, min_periods=1).std().fillna(1.0)
    df['OBV_ZScore'] = (obv - obv_ma) / np.maximum(obv_std, 1e-6)

    # ── 9. SMC Structural Liquidity Sweeps ──
    hh20 = high_series.rolling(20, min_periods=5).max().shift(1)
    ll20 = low_series.rolling(20, min_periods=5).min().shift(1)
    df['BSL_Swept_20'] = ((high_series > hh20) & (close_series < hh20)).astype(float).fillna(0.0)
    df['SSL_Swept_20'] = ((low_series < ll20) & (close_series > ll20)).astype(float).fillna(0.0)

    # Fair Value Gap (FVG)
    high_shift2 = high_series.shift(2)
    low_shift2 = low_series.shift(2)
    df['Bullish_FVG'] = np.maximum(0.0, (low_series - high_shift2).fillna(0.0)) / safe_atr
    df['Bearish_FVG'] = np.maximum(0.0, (low_shift2 - high_series).fillna(0.0)) / safe_atr

    # ── 10. Multi-Timeframe Trend Proxies (1h / 4h synthetic EMAs) ──
    ema_1h = close_series.ewm(span=min(36, n_candles), adjust=False).mean()
    df['HTF_1h_Align'] = np.where(close_series > ema_1h, 1.0, -1.0)
    ema_4h = close_series.ewm(span=min(144, n_candles), adjust=False).mean()
    df['HTF_4h_Align'] = np.where(close_series > ema_4h, 1.0, -1.0)

    # ── 11. Market Regime Classification ──
    df = detect_market_regime(df)

    # ── 12. Strict Data Leakage Prevention (Rule 12) ──
    # Clean infinities, forward fill, and drop warmup period
    df = df.replace([np.inf, -np.inf], np.nan)
    df = df.ffill()

    if drop_warmup and len(df) > WARMUP_PERIOD + 20:
        df = df.iloc[WARMUP_PERIOD:].reset_index(drop=True)

    df = df.fillna(0.0)
    return df

if __name__ == "__main__":
    from dataset import fetch_historical_data
    df = fetch_historical_data("BTCUSDT", "5m", 300)
    features_df = generate_features(df)
    print(f"[+] Successfully generated {len(features_df.columns)} features for {len(features_df)} candles.")
    print("Market Regimes detected:", features_df['market_regime'].value_counts().to_dict())
