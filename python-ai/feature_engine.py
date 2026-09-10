import pandas as pd
import pandas_ta as ta
import numpy as np

def generate_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Generate all requested technical features for the AI model using pandas-ta.
    """
    if df.empty or len(df) < 15:
        return df
        
    df = df.copy()
    close_series: pd.Series = pd.Series(df['close'])
    high_series: pd.Series = pd.Series(df['high'])
    low_series: pd.Series = pd.Series(df['low'])
    
    # -- EMAs (fallback to available length if fewer candles exist)
    n_candles = len(df)
    df['EMA_9'] = ta.ema(close_series, length=min(9, n_candles))
    df['EMA_20'] = ta.ema(close_series, length=min(20, n_candles))
    df['EMA_50'] = ta.ema(close_series, length=min(50, n_candles))
    df['EMA_100'] = ta.ema(close_series, length=min(100, n_candles))
    df['EMA_200'] = ta.ema(close_series, length=min(200, n_candles))
    
    # -- Set default fallbacks for indicator columns
    df['RSI'] = pd.Series(50.0, index=df.index)
    df['MACD'] = pd.Series(0.0, index=df.index)
    df['MACD_Signal'] = pd.Series(0.0, index=df.index)
    df['MACD_Hist'] = pd.Series(0.0, index=df.index)
    df['ATR'] = (df['high'] - df['low']).replace(0, 0.0001)
    df['ADX'] = pd.Series(25.0, index=df.index)
    df['CCI'] = pd.Series(0.0, index=df.index)
    df['MOM'] = pd.Series(0.0, index=df.index)
    df['BB_Lower'] = df['close']
    df['BB_Mid'] = df['close']
    df['BB_Upper'] = df['close']
    df['STOCHRSI_K'] = pd.Series(50.0, index=df.index)
    df['STOCHRSI_D'] = pd.Series(50.0, index=df.index)
    df['ROC'] = pd.Series(0.0, index=df.index)
    df['WILLR'] = pd.Series(-50.0, index=df.index)

    # -- Oscillators & Momentum
    rsi_calc = ta.rsi(close_series, length=min(14, n_candles))
    if rsi_calc is not None and not rsi_calc.empty:
        df['RSI'] = rsi_calc

    macd = ta.macd(close_series)
    if macd is not None and not macd.empty:
        df['MACD'] = macd.iloc[:, 0]
        df['MACD_Signal'] = macd.iloc[:, 2]
        df['MACD_Hist'] = macd.iloc[:, 1]
    
    atr_calc = ta.atr(high_series, low_series, close_series, length=min(7, n_candles))
    if atr_calc is not None and not atr_calc.empty:
        df['ATR'] = atr_calc
    
    adx = ta.adx(high_series, low_series, close_series)
    if adx is not None and not adx.empty:
        df['ADX'] = adx.iloc[:, 0]
        
    cci_calc = ta.cci(high_series, low_series, close_series, length=min(14, n_candles))
    if cci_calc is not None and not cci_calc.empty:
        df['CCI'] = cci_calc

    mom_calc = ta.mom(close_series, length=min(10, n_candles))
    if mom_calc is not None and not mom_calc.empty:
        df['MOM'] = mom_calc
    
    # -- VWAP (Volume Weighted Average Price)
    try:
        typ_price = (df['high'] + df['low'] + df['close']) / 3.0
        cum_vol = df['volume'].cumsum()
        cum_vol_price = (typ_price * df['volume']).cumsum()
        df['VWAP'] = np.where(cum_vol > 0, cum_vol_price / cum_vol, df['close'])
    except Exception:
        df['VWAP'] = df['close']
        
    # -- Bollinger Bands
    bbands = ta.bbands(close_series, length=min(20, n_candles))
    if bbands is not None and not bbands.empty:
        df['BB_Lower'] = bbands.iloc[:, 0]
        df['BB_Mid'] = bbands.iloc[:, 1]
        df['BB_Upper'] = bbands.iloc[:, 2]
        
    # -- Stochastic RSI (Ultra-Fast Vectorized)
    rsi_s = pd.Series(df['RSI'])
    rsi_min = rsi_s.rolling(14, min_periods=1).min()
    rsi_max = rsi_s.rolling(14, min_periods=1).max()
    rsi_diff = (rsi_max - rsi_min).replace(0, 0.0001)
    df['STOCHRSI_K'] = ((rsi_s - rsi_min) / rsi_diff) * 100
    df['STOCHRSI_D'] = pd.Series(df['STOCHRSI_K']).rolling(3, min_periods=1).mean()
        
    roc_calc = ta.roc(close_series, length=min(14, n_candles))
    if roc_calc is not None and not roc_calc.empty:
        df['ROC'] = roc_calc

    willr_calc = ta.willr(high_series, low_series, close_series, length=min(14, n_candles))
    if willr_calc is not None and not willr_calc.empty:
        df['WILLR'] = willr_calc
    
    # -- Custom Features & Ratios for Ultra-High Accuracy
    df['Body_Size'] = df['close'] - df['open']
    df['Upper_Wick'] = df['high'] - df[['open', 'close']].max(axis=1)
    df['Lower_Wick'] = df[['open', 'close']].min(axis=1) - df['low']
    df['Candle_Range'] = df['high'] - df['low']
    df['Body_Ratio'] = np.where(df['Candle_Range'] > 0, abs(df['Body_Size']) / df['Candle_Range'], 0)
    df['Upper_Wick_Ratio'] = np.where(df['Candle_Range'] > 0, df['Upper_Wick'] / df['Candle_Range'], 0)
    df['Lower_Wick_Ratio'] = np.where(df['Candle_Range'] > 0, df['Lower_Wick'] / df['Candle_Range'], 0)
    
    # -- Institutional EMA Ratios & Velocity
    df['EMA_9_20_Diff'] = (df['EMA_9'] - df['EMA_20']) / df['close']
    df['EMA_20_50_Diff'] = (df['EMA_20'] - df['EMA_50']) / df['close']
    df['EMA_50_200_Diff'] = (df['EMA_50'] - df['EMA_200']) / df['close']
    
    # -- Volatility & Momentum Ratios
    df['ATR_Rel'] = np.where(df['close'] > 0, df['ATR'] / df['close'], 0)
    df['BB_Width'] = np.where(df['BB_Mid'] > 0, (df['BB_Upper'] - df['BB_Lower']) / df['BB_Mid'], 0)
    df['RSI_Vel'] = rsi_s.diff()
    
    # -- Pure Vectorized Pattern Recognition (Zero TA-Lib warnings)
    body = (df['close'] - df['open']).abs()
    rng = df['high'] - df['low']
    rng_safe = np.where(rng > 0, rng, 1.0)
    upper_w = df['high'] - df[['open', 'close']].max(axis=1)
    lower_w = df[['open', 'close']].min(axis=1) - df['low']

    # Doji: body <= 10% of total candle range
    df['CDL_DOJI'] = np.where(body / rng_safe <= 0.10, 100, 0)

    # Hammer / Shooting Star: lower wick >= 2x body and upper wick <= 0.2 * body
    is_hammer = (lower_w >= 2 * body) & (upper_w <= 0.2 * body) & (body > 0)
    df['CDL_HAMMER'] = np.where(is_hammer, 100, 0)

    # Engulfing: current candle body engulfs previous candle body
    prev_open = df['open'].shift(1)
    prev_close = df['close'].shift(1)
    bull_engulf = (df['close'] > df['open']) & (prev_close < prev_open) & (df['close'] >= prev_open) & (df['open'] <= prev_close)
    bear_engulf = (df['close'] < df['open']) & (prev_close > prev_open) & (df['close'] <= prev_open) & (df['open'] >= prev_close)
    df['CDL_ENGULFING'] = np.where(bull_engulf, 100, np.where(bear_engulf, -100, 0))
            
    # -- Stochastic Oscillator (Ultra-Fast Vectorized)
    low_14 = df['low'].rolling(14, min_periods=1).min()
    high_14 = df['high'].rolling(14, min_periods=1).max()
    stoch_diff = (high_14 - low_14).replace(0, 0.0001)
    df['STOCH_K'] = ((df['close'] - low_14) / stoch_diff) * 100
    df['STOCH_D'] = df['STOCH_K'].rolling(3, min_periods=1).mean()

    # -- Keltner Channels (Ultra-Fast Vectorized)
    tp = (df['high'] + df['low'] + df['close']) / 3.0
    kc_mid = ta.ema(tp, length=min(20, n_candles))
    df['KC_Mid'] = kc_mid if kc_mid is not None else tp
    df['KC_Upper'] = df['KC_Mid'] + (2.0 * df['ATR'])
    df['KC_Lower'] = df['KC_Mid'] - (2.0 * df['ATR'])
    kc_diff = (df['KC_Upper'] - df['KC_Lower']).replace(0, 0.0001)
    df['KC_Pos'] = (df['close'] - df['KC_Lower']) / kc_diff

    # -- Pivot Points (Classic relative distance)
    prev_h = df['high'].shift(1)
    prev_l = df['low'].shift(1)
    prev_c = df['close'].shift(1)
    pp = (prev_h + prev_l + prev_c) / 3.0
    r1 = (2 * pp) - prev_l
    s1 = (2 * pp) - prev_h
    df['PP_Dist'] = np.where(df['close'] > 0, (df['close'] - pp) / df['close'], 0)
    df['R1_Dist'] = np.where(df['close'] > 0, (df['close'] - r1) / df['close'], 0)
    df['S1_Dist'] = np.where(df['close'] > 0, (df['close'] - s1) / df['close'], 0)

    # -- Force Index & Volume Profile Proxy
    df['Force_Index'] = (df['close'] - df['close'].shift(1)) * df['volume']
    df['Force_Index_EMA'] = ta.ema(pd.Series(df['Force_Index']), length=13)

    # -- EMA Slopes & Acceleration (3-bar velocity)
    df['EMA_9_Slope'] = (df['EMA_9'] - df['EMA_9'].shift(3)) / df['close']
    df['EMA_20_Slope'] = (df['EMA_20'] - df['EMA_20'].shift(3)) / df['close']
    df['EMA_50_Slope'] = (df['EMA_50'] - df['EMA_50'].shift(3)) / df['close']

    # -- ATR Volatility Expansion Ratio (Current ATR vs 20-period Moving Average of ATR)
    atr_ma20 = df['ATR'].rolling(window=20).mean()
    df['ATR_Expansion_Ratio'] = np.where(atr_ma20 > 0, df['ATR'] / atr_ma20, 1.0)

    # -- Trend Confluence Composite Index (-3 to +3)
    ema9_s = pd.Series(df['EMA_9'])
    ema20_s = pd.Series(df['EMA_20'])
    ema50_s = pd.Series(df['EMA_50'])
    macd_h_s = pd.Series(df['MACD_Hist'])

    bull_count = (
        (ema9_s > ema20_s).astype(int) +
        (ema20_s > ema50_s).astype(int) +
        (macd_h_s > 0).astype(int) +
        (rsi_s > 50).astype(int)
    )
    bear_count = (
        (ema9_s < ema20_s).astype(int) +
        (ema20_s < ema50_s).astype(int) +
        (macd_h_s < 0).astype(int) +
        (rsi_s < 50).astype(int)
    )
    df['Trend_Confluence_Score'] = bull_count - bear_count

    df.bfill(inplace=True)
    df.ffill(inplace=True)
    df.fillna(0, inplace=True)
    return df
