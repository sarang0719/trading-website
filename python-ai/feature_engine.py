from typing import Any
import numpy as np
import pandas as pd
import pandas_ta as _ta

ta: Any = _ta

def _safe_series(s: Any, fallback: Any) -> pd.Series:
    if s is not None and isinstance(s, pd.Series) and not s.empty:
        return s
    if isinstance(fallback, pd.Series):
        return fallback
    return pd.Series(fallback)

def generate_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    High-performance feature generation pipeline for AI Next Candle Prediction.
    Generates all 57 institutional features with full Pyright type-safety,
    zero divide-by-zero warnings, and clean modern pandas operations.
    """
    if df.empty or len(df) < 5:
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

    # ── 2. Momentum & Oscillators ──
    rsi_raw = ta.rsi(close_series, length=min(14, n_candles))
    rsi_s = _safe_series(rsi_raw, pd.Series(50.0, index=df.index))
    df['RSI'] = rsi_s

    macd_calc = ta.macd(close_series)
    if macd_calc is not None and isinstance(macd_calc, pd.DataFrame) and not macd_calc.empty:
        df['MACD'] = macd_calc.iloc[:, 0]
        df['MACD_Hist'] = macd_calc.iloc[:, 1]
        df['MACD_Signal'] = macd_calc.iloc[:, 2]
    else:
        df['MACD'] = 0.0
        df['MACD_Hist'] = 0.0
        df['MACD_Signal'] = 0.0

    atr_calc = ta.atr(high_series, low_series, close_series, length=min(7, n_candles))
    df['ATR'] = _safe_series(atr_calc, pd.Series(np.maximum(0.0001, high_np - low_np), index=df.index))

    adx_calc = ta.adx(high_series, low_series, close_series)
    if adx_calc is not None and isinstance(adx_calc, pd.DataFrame) and not adx_calc.empty:
        df['ADX'] = adx_calc.iloc[:, 0]
    else:
        df['ADX'] = 25.0

    cci_calc = ta.cci(high_series, low_series, close_series, length=min(14, n_candles))
    df['CCI'] = _safe_series(cci_calc, pd.Series(0.0, index=df.index))

    mom_calc = ta.mom(close_series, length=min(10, n_candles))
    df['MOM'] = _safe_series(mom_calc, pd.Series(0.0, index=df.index))

    # ── 3. Bollinger Bands ──
    bbands = ta.bbands(close_series, length=min(20, n_candles))
    if bbands is not None and isinstance(bbands, pd.DataFrame) and not bbands.empty:
        df['BB_Lower'] = bbands.iloc[:, 0]
        df['BB_Mid'] = bbands.iloc[:, 1]
        df['BB_Upper'] = bbands.iloc[:, 2]
    else:
        df['BB_Lower'] = close_series
        df['BB_Mid'] = close_series
        df['BB_Upper'] = close_series

    # ── 4. Stochastic RSI ──
    rsi_min = rsi_s.rolling(14, min_periods=1).min()
    rsi_max = rsi_s.rolling(14, min_periods=1).max()
    rsi_diff = np.where((rsi_max - rsi_min) > 0, rsi_max - rsi_min, 0.0001)
    df['STOCHRSI_K'] = ((rsi_s - rsi_min) / rsi_diff) * 100.0
    stoch_k_s = pd.Series(df['STOCHRSI_K'], dtype=float)
    df['STOCHRSI_D'] = stoch_k_s.rolling(3, min_periods=1).mean()

    # ── 5. Rate of Change & Williams %R ──
    roc_calc = ta.roc(close_series, length=min(14, n_candles))
    df['ROC'] = _safe_series(roc_calc, pd.Series(0.0, index=df.index))

    willr_calc = ta.willr(high_series, low_series, close_series, length=min(14, n_candles))
    df['WILLR'] = _safe_series(willr_calc, pd.Series(-50.0, index=df.index))

    # ── 6. VWAP ──
    typ_price = (high_np + low_np + close_np) / 3.0
    cum_vol = np.cumsum(vol_np)
    cum_vol_price = np.cumsum(typ_price * vol_np)
    df['VWAP'] = np.where(cum_vol > 0, cum_vol_price / np.maximum(cum_vol, 1e-6), close_np)

    # ── 7. Price Action & Candle Geometry ──
    df['Body_Size'] = close_np - open_np
    candle_max = np.maximum(open_np, close_np)
    candle_min = np.minimum(open_np, close_np)
    df['Upper_Wick'] = high_np - candle_max
    df['Lower_Wick'] = candle_min - low_np
    df['Candle_Range'] = high_np - low_np
    safe_range = np.where(df['Candle_Range'].to_numpy() > 0, df['Candle_Range'].to_numpy(), 0.0001)

    df['Body_Ratio'] = np.abs(df['Body_Size'].to_numpy()) / safe_range
    df['Upper_Wick_Ratio'] = df['Upper_Wick'].to_numpy() / safe_range
    df['Lower_Wick_Ratio'] = df['Lower_Wick'].to_numpy() / safe_range

    # ── 8. EMA Ratios & Velocity ──
    df['EMA_9_20_Diff'] = (pd.Series(df['EMA_9'], dtype=float).to_numpy() - pd.Series(df['EMA_20'], dtype=float).to_numpy()) / safe_close
    df['EMA_20_50_Diff'] = (pd.Series(df['EMA_20'], dtype=float).to_numpy() - pd.Series(df['EMA_50'], dtype=float).to_numpy()) / safe_close
    df['EMA_50_200_Diff'] = (pd.Series(df['EMA_50'], dtype=float).to_numpy() - pd.Series(df['EMA_200'], dtype=float).to_numpy()) / safe_close

    # ── 9. Volatility & Momentum Ratios ──
    df['ATR_Rel'] = pd.Series(df['ATR'], dtype=float).to_numpy() / safe_close
    bb_mid_np = pd.Series(df['BB_Mid'], dtype=float).to_numpy()
    safe_bb_mid = np.where(bb_mid_np > 0, bb_mid_np, 1.0)
    df['BB_Width'] = (pd.Series(df['BB_Upper'], dtype=float).to_numpy() - pd.Series(df['BB_Lower'], dtype=float).to_numpy()) / safe_bb_mid
    df['RSI_Vel'] = rsi_s.diff().fillna(0.0)

    # ── 10. Vectorized Candlestick Patterns ──
    body_abs = np.abs(df['Body_Size'].to_numpy())
    df['CDL_DOJI'] = np.where((body_abs / safe_range) <= 0.10, 100, 0)

    is_hammer = (df['Lower_Wick'].to_numpy() >= 2.0 * body_abs) & (df['Upper_Wick'].to_numpy() <= 0.2 * body_abs) & (body_abs > 0)
    df['CDL_HAMMER'] = np.where(is_hammer, 100, 0)

    prev_open = open_series.shift(1).to_numpy()
    prev_close = close_series.shift(1).to_numpy()
    bull_engulf = (close_np > open_np) & (prev_close < prev_open) & (close_np >= prev_open) & (open_np <= prev_close)
    bear_engulf = (close_np < open_np) & (prev_close > prev_open) & (close_np <= prev_open) & (open_np >= prev_close)
    df['CDL_ENGULFING'] = np.where(bull_engulf, 100, np.where(bear_engulf, -100, 0))

    # ── 11. Stochastic Oscillator ──
    low_14 = low_series.rolling(14, min_periods=1).min()
    high_14 = high_series.rolling(14, min_periods=1).max()
    stoch_diff = np.where((high_14 - low_14) > 0, high_14 - low_14, 0.0001)
    df['STOCH_K'] = ((close_series - low_14) / stoch_diff) * 100.0
    stoch_k_series = pd.Series(df['STOCH_K'], dtype=float)
    df['STOCH_D'] = stoch_k_series.rolling(3, min_periods=1).mean()

    # ── 12. Keltner Channels ──
    tp_series = pd.Series(typ_price, index=df.index, dtype=float)
    kc_mid = ta.ema(tp_series, length=min(20, n_candles))
    df['KC_Mid'] = _safe_series(kc_mid, tp_series)
    atr_series = pd.Series(df['ATR'], dtype=float)
    df['KC_Upper'] = pd.Series(df['KC_Mid'], dtype=float) + (2.0 * atr_series)
    df['KC_Lower'] = pd.Series(df['KC_Mid'], dtype=float) - (2.0 * atr_series)
    kc_diff = np.where((df['KC_Upper'] - df['KC_Lower']) > 0, df['KC_Upper'] - df['KC_Lower'], 0.0001)
    df['KC_Pos'] = (close_series - df['KC_Lower']) / kc_diff

    # ── 13. Pivot Points Distances ──
    prev_h = high_series.shift(1).bfill().to_numpy()
    prev_l = low_series.shift(1).bfill().to_numpy()
    prev_c = close_series.shift(1).bfill().to_numpy()
    pp = (prev_h + prev_l + prev_c) / 3.0
    r1 = (2.0 * pp) - prev_l
    s1 = (2.0 * pp) - prev_h
    df['PP_Dist'] = (close_np - pp) / safe_close
    df['R1_Dist'] = (close_np - r1) / safe_close
    df['S1_Dist'] = (close_np - s1) / safe_close

    # ── 14. Force Index ──
    close_shift1 = close_series.shift(1).fillna(close_series).to_numpy()
    force_idx_np = (close_np - close_shift1) * vol_np
    df['Force_Index'] = force_idx_np
    fi_series = pd.Series(force_idx_np, index=df.index, dtype=float)
    fi_ema = ta.ema(fi_series, length=13)
    df['Force_Index_EMA'] = _safe_series(fi_ema, fi_series)

    # ── 15. EMA Slopes ──
    ema9_series = pd.Series(df['EMA_9'], dtype=float)
    ema20_series = pd.Series(df['EMA_20'], dtype=float)
    ema50_series = pd.Series(df['EMA_50'], dtype=float)
    df['EMA_9_Slope'] = (ema9_series - ema9_series.shift(3).bfill()).to_numpy() / safe_close
    df['EMA_20_Slope'] = (ema20_series - ema20_series.shift(3).bfill()).to_numpy() / safe_close
    df['EMA_50_Slope'] = (ema50_series - ema50_series.shift(3).bfill()).to_numpy() / safe_close

    # ── 16. ATR Expansion ──
    atr_ma20 = np.asarray(atr_series.rolling(window=20, min_periods=1).mean())
    df['ATR_Expansion_Ratio'] = np.where(atr_ma20 > 0, atr_series.to_numpy() / atr_ma20, 1.0)

    # ── 17. Trend Confluence Score ──
    ema9_val = ema9_series.to_numpy()
    ema20_val = ema20_series.to_numpy()
    ema50_val = ema50_series.to_numpy()
    macd_h_val = pd.Series(df['MACD_Hist'], dtype=float).to_numpy()
    rsi_val = rsi_s.to_numpy()

    bull_count = (
        (ema9_val > ema20_val).astype(int) +
        (ema20_val > ema50_val).astype(int) +
        (macd_h_val > 0).astype(int) +
        (rsi_val > 50).astype(int)
    )
    bear_count = (
        (ema9_val < ema20_val).astype(int) +
        (ema20_val < ema50_val).astype(int) +
        (macd_h_val < 0).astype(int) +
        (rsi_val < 50).astype(int)
    )
    df['Trend_Confluence_Score'] = bull_count - bear_count

    # ── 18. SMC Order Block & Liquidity ──
    df['Wick_Exhaustion_Diff'] = (df['Lower_Wick'].to_numpy() - df['Upper_Wick'].to_numpy()) / safe_range
    body_ratio_np = pd.Series(df['Body_Ratio'], dtype=float).to_numpy()
    vol_delta = np.where(close_np >= open_np, vol_np * body_ratio_np, -vol_np * body_ratio_np)
    vol_delta_s = pd.Series(vol_delta, index=df.index, dtype=float)
    df['Volume_Delta_Proxy'] = vol_delta_s
    df['Volume_Delta_MA'] = vol_delta_s.rolling(5, min_periods=1).mean()

    # ── 19. Multi-EMA Stack Alignment Score ──
    ema100_val = pd.Series(df['EMA_100'], dtype=float).to_numpy()
    ema200_val = pd.Series(df['EMA_200'], dtype=float).to_numpy()
    df['EMA_Stack_Score'] = (
        (ema9_val > ema20_val).astype(int) +
        (ema20_val > ema50_val).astype(int) +
        (ema50_val > ema100_val).astype(int) +
        (ema100_val > ema200_val).astype(int) -
        (ema9_val < ema20_val).astype(int) -
        (ema20_val < ema50_val).astype(int) -
        (ema50_val < ema100_val).astype(int) -
        (ema100_val < ema200_val).astype(int)
    )

    # ── 20. Institutional Multi-Lag Returns & Velocity ──
    ret1 = close_series.pct_change(1).fillna(0.0)
    df['Ret_1'] = ret1
    df['Ret_2'] = close_series.pct_change(2).fillna(0.0)
    df['Ret_3'] = close_series.pct_change(3).fillna(0.0)
    df['Ret_5'] = close_series.pct_change(5).fillna(0.0)
    df['Ret_8'] = close_series.pct_change(8).fillna(0.0)
    df['Ret_13'] = close_series.pct_change(13).fillna(0.0)
    df['Ret_Accel'] = (ret1 - ret1.shift(1)).fillna(0.0)

    # ── 21. Close Location Value (CLV: -1 = low, +1 = high) ──
    clv = ((close_np - low_np) - (high_np - close_np)) / safe_range
    clv_series = pd.Series(clv, index=df.index, dtype=float)
    df['CLV'] = clv_series
    df['CLV_MA5'] = clv_series.rolling(5, min_periods=1).mean()
    df['CLV_MA10'] = clv_series.rolling(10, min_periods=1).mean()

    # ── 22. Higher-Timeframe Trend & Alignment ──
    ema_1h_fast = close_series.ewm(span=min(36, n_candles), adjust=False).mean()
    ema_1h_slow = close_series.ewm(span=min(84, n_candles), adjust=False).mean()
    df['HTF_1h_Trend'] = np.where(ema_1h_fast > ema_1h_slow, 1.0, -1.0)
    df['HTF_1h_Dist'] = (close_series - ema_1h_fast) / safe_close

    ema_4h_fast = close_series.ewm(span=min(144, n_candles), adjust=False).mean()
    ema_4h_slow = close_series.ewm(span=min(336, n_candles), adjust=False).mean()
    df['HTF_4h_Trend'] = np.where(ema_4h_fast > ema_4h_slow, 1.0, -1.0)

    # ── 23. SMC Liquidity Sweeps (BSL/SSL Rejections) ──
    hh20 = high_series.rolling(20, min_periods=5).max().shift(1).to_numpy()
    ll20 = low_series.rolling(20, min_periods=5).min().shift(1).to_numpy()
    df['BSL_Swept_20'] = ((high_np > hh20) & (close_np < hh20)).astype(float)
    df['SSL_Swept_20'] = ((low_np < ll20) & (close_np > ll20)).astype(float)

    hh50 = high_series.rolling(50, min_periods=10).max().shift(1).to_numpy()
    ll50 = low_series.rolling(50, min_periods=10).min().shift(1).to_numpy()
    df['BSL_Swept_50'] = ((high_np > hh50) & (close_np < hh50)).astype(float)
    df['SSL_Swept_50'] = ((low_np < ll50) & (close_np > ll50)).astype(float)

    # ── 24. Fair Value Gaps (FVG) ──
    high_shift2 = high_series.shift(2).bfill().to_numpy()
    low_shift2 = low_series.shift(2).bfill().to_numpy()
    df['Bullish_FVG'] = np.maximum(0.0, (low_np - high_shift2)) / safe_close
    df['Bearish_FVG'] = np.maximum(0.0, (low_shift2 - high_np)) / safe_close

    # ── 25. Volume Dynamics & OBV Z-Score ──
    vol_ma20 = vol_series.rolling(20, min_periods=1).mean()
    df['Vol_Surge'] = vol_series / np.maximum(vol_ma20, 1e-6)

    obv_step = np.sign(ret1) * vol_series
    obv = obv_step.cumsum()
    obv_ma = obv.rolling(20, min_periods=1).mean()
    obv_std = obv.rolling(20, min_periods=1).std().fillna(1.0)
    df['OBV_ZScore'] = (obv - obv_ma) / np.maximum(obv_std, 1e-6)

    # ── 26. Directional Persistence & Streak ──
    dir_sign = np.sign(ret1)
    df['Dir_Persistence_3'] = dir_sign.rolling(3, min_periods=1).sum()
    df['Dir_Persistence_5'] = dir_sign.rolling(5, min_periods=1).sum()

    # ── 27. Volatility Squeeze (Bollinger inside Keltner) ──
    bb_u = pd.Series(df['BB_Upper'], dtype=float)
    bb_l = pd.Series(df['BB_Lower'], dtype=float)
    kc_u = pd.Series(df['KC_Upper'], dtype=float)
    kc_l = pd.Series(df['KC_Lower'], dtype=float)
    df['In_Squeeze'] = ((bb_u < kc_u) & (bb_l > kc_l)).astype(float)

    # ── 28. Macro 200 EMA & VWAP Extension ──
    df['Dist_EMA200'] = (close_series - df['EMA_200']) / safe_close
    df['Above_EMA200'] = (close_series > df['EMA_200']).astype(float)
    df['VWAP_Dist'] = (close_series - df['VWAP']) / safe_close
    df['RSI_Slope3'] = (rsi_s - rsi_s.shift(3).bfill()) / 10.0

    # Clean fillna & infinities without deprecated inplace
    df = df.replace([np.inf, -np.inf], 0.0)
    df = df.bfill().ffill().fillna(0.0)
    return df
