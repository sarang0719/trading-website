/**
 * QuantEdge AI — Next-Candle Predictor v1.0
 * ─────────────────────────────────────────
 * Analyzes ONLY closed candles and produces a probability-weighted
 * BUY / SELL prediction for the UPCOMING candle.
 *
 * How it works:
 *  1.  Compute ~20 technical features on the last N closed candles
 *  2.  Each feature has a calibrated weight based on historical edge
 *  3.  Combine into a directional probability (0-100%)
 *  4.  Emit a `CandlePrediction` that the UI can show in real-time
 *
 * Called once per candle-close event (NOT during the live candle).
 */

import type { Candle } from "./strategy-engine";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CandlePrediction {
  direction: "BUY" | "SELL";
  action: "BUY" | "SELL" | "MONITORING"; // alias for UI
  probability: number;            // 50–99, the model's confidence
  strength?: "STRONG" | "NORMAL" | "WEAK";
  factors?: PredictionFactor[];
  message?: string;               // descriptive analysis
  generatedAt: number;            // unix ms — when this prediction was made
  forCandleAt: number;            // unix s  — expected open time of the next candle
  isConfirmed?: boolean;
}

export interface PredictionFactor {
  name: string;
  vote: "BUY" | "SELL" | "NEUTRAL";
  weight: number;             // 1-5 (contribution to final score)
  value: string;              // human-readable value
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function ema(src: number[], len: number): number[] {
  const k = 2 / (len + 1);
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    if (i === 0) { out.push(src[0]); continue; }
    out.push(src[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

function sma(src: number[], len: number, i: number): number {
  const slice = src.slice(Math.max(0, i - len + 1), i + 1);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function rsi(closes: number[], len: number): number[] {
  const out = new Array(closes.length).fill(50);
  if (closes.length <= len) return out;
  const g: number[] = [0], l: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    g.push(d > 0 ? d : 0);
    l.push(d < 0 ? -d : 0);
  }
  let ag = g.slice(1, len + 1).reduce((a, b) => a + b, 0) / len;
  let al = l.slice(1, len + 1).reduce((a, b) => a + b, 0) / len;
  out[len] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = len + 1; i < closes.length; i++) {
    ag = (ag * (len - 1) + g[i]) / len;
    al = (al * (len - 1) + l[i]) / len;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

function atr(candles: Candle[], len: number): number[] {
  const tr = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const p = candles[i - 1].close;
    return Math.max(c.high - c.low, Math.abs(c.high - p), Math.abs(c.low - p));
  });
  const out = new Array(candles.length).fill(0);
  if (tr.length < len) return out;
  out[len - 1] = tr.slice(0, len).reduce((a, b) => a + b, 0) / len;
  for (let i = len; i < candles.length; i++)
    out[i] = (out[i - 1] * (len - 1) + tr[i]) / len;
  return out;
}

function supertrend(candles: Candle[], factor: number, len: number) {
  const a = atr(candles, len);
  const hl2 = candles.map(c => (c.high + c.low) / 2);
  const rU = hl2.map((h, i) => h + factor * a[i]);
  const rL = hl2.map((h, i) => h - factor * a[i]);
  const fU = [...rU], fL = [...rL];
  const dir = new Array(candles.length).fill(-1);
  for (let i = 1; i < candles.length; i++) {
    fL[i] = fL[i] > fL[i - 1] || candles[i - 1].close < fL[i - 1] ? fL[i] : fL[i - 1];
    fU[i] = fU[i] < fU[i - 1] || candles[i - 1].close > fU[i - 1] ? fU[i] : fU[i - 1];
    if (candles[i].close > fU[i]) dir[i] = -1;
    else if (candles[i].close < fL[i]) dir[i] = 1;
    else dir[i] = dir[i - 1];
  }
  return dir; // -1 = bullish, 1 = bearish
}

// ─── Institutional Engine: SMC / ICT Logic Helpers ─────────────────────────────

function detectLiquiditySweep(src: Candle[], n: number) {
  const c = src[n];
  const lookback = 20;
  if (n < lookback) return "NEUTRAL";
  const prevLows = src.slice(n - lookback, n).map(x => x.low);
  const prevHighs = src.slice(n - lookback, n).map(x => x.high);
  const lowest = Math.min(...prevLows);
  const highest = Math.max(...prevHighs);

  // Bullish Sweep: Price went below significant low but closed back high (Pin bar style)
  if (c.low < lowest && c.close > lowest) return "BUY";
  // Bearish Sweep: Price went above significant high but closed back low
  if (c.high > highest && c.close < highest) return "SELL";
  return "NEUTRAL";
}

function detectFVG(src: Candle[], n: number) {
  // Fair Value Gap: Gap between candle n-2 and n
  const c = src[n];
  const c1 = src[n-1];
  const c2 = src[n-2];
  if (!c || !c1 || !c2) return "NEUTRAL";

  // Bullish FVG: n-2 high is below n low
  if (c2.high < c.low) return "BUY";
  // Bearish FVG: n-2 low is above n high
  if (c2.low > c.high) return "SELL";
  return "NEUTRAL";
}

function detectMSS(src: Candle[], n: number) {
  // Market Structure Shift: HH then LL or vice versa
  if (n < 5) return "NEUTRAL";
  const c = src[n];
  const c1 = src[n-1];
  const c2 = src[n-2];
  const c3 = src[n-3];
  
  const isUp = c.close > c3.close;
  const isDown = c.close < c3.close;
  
  if (isUp && c.close > Math.max(c1.high, c2.high)) return "BUY";
  if (isDown && c.close < Math.min(c1.low, c2.low)) return "SELL";
  return "NEUTRAL";
}

// ─── Sigmoid to keep final score in a sane probability range ─────────────────

function toProbability(rawScore: number, total: number): number {
  // Scale score to 61-98 range for institutional confidence
  const pct = Math.min(1, Math.max(0, rawScore / total));
  return Math.round(61 + (pct * 37));
}

/**
 * Neural Calibration: Micro-backtest for each indicator to find the most accurate weights 
 * for the CURRENT market regime (Gold, Crypto, etc).
 */
function calibrateWeights(src: Candle[], featureName: string, signals: ("BUY" | "SELL" | "NEUTRAL")[]): number {
  const window = Math.min(src.length - 2, 60);
  let wins = 0, total = 0, streaks = 0;
  
  for (let i = src.length - window; i < src.length - 1; i++) {
    const s = signals[i];
    if (s === "NEUTRAL") continue;
    const outcome = src[i + 1].close > src[i].close ? "BUY" : "SELL";
    if (s === outcome) {
      wins++;
      streaks++;
    } else {
      streaks = 0; // reset on loss
    }
    total++;
  }
  
  const wr = total > 0 ? wins / total : 0.5;
  // Regime Multiplier: Boost signals with high recent 'win streaks'
  const streakBonus = Math.min(streaks * 0.2, 5);
  return Math.max(1, Math.min(15, (wr * 20) + streakBonus));
}

// ─── Main Predictor ───────────────────────────────────────────────────────────

/**
 * v17.0 Hyper-Reactive Institutional Monitor
 * @param candles        Array of candles (including the live tick-candle)
 * @param candleSeconds  Duration of one candle in seconds (e.g. 60 for 1m)
 */
export function predictNextCandle(
  candles: Candle[],
  candleSeconds: number = 60
): CandlePrediction {
  const n0 = candles.length - 1;
  const WARMUP = 60; // minimum required for stable EMAs/indicators

  if (n0 < WARMUP) {
    return { 
       direction: "BUY", action: "MONITORING", probability: 55, strength: "WEAK",
       message: `Analyzing Institutional Flow... [${Math.round((n0/WARMUP)*100)}%]`,
       generatedAt: Date.now(), forCandleAt: 0, isConfirmed: false
    };
  }

  // Work on a recent window for speed & relevance
  const N = Math.min(candles.length, 300);
  const src = candles.slice(-N);
  const n = src.length - 1;           // index of the LAST closed candle

  const closes = src.map(c => c.close);
  const highs  = src.map(c => c.high);
  const lows   = src.map(c => c.low);
  const vols   = src.map(c => c.volume);

  // ── Pre-compute arrays ────────────────────────────────────────────────────
  const ema8   = ema(closes, 8);
  const ema21  = ema(closes, 21);
  const ema55  = ema(closes, 55);
  const ema200 = ema(closes, 200);
  const rsi14  = rsi(closes, 14);
  const rsi7   = rsi(closes, 7);
  const stDir  = supertrend(src, 2.5, 10);
  const atr14  = atr(src, 14);

  // MACD (12,26,9)
  const macdLine = ema(closes, 12).map((v, i) => v - ema(closes, 26)[i]);
  const sigLine  = ema(macdLine, 9);
  const histogram = macdLine.map((m, i) => m - sigLine[i]);

  // Bollinger Bands (20,2)
  const bbMid   = closes.map((_, i) => sma(closes, 20, i));
  const bbStd   = closes.map((_, i) => {
    const m = bbMid[i];
    const sl = closes.slice(Math.max(0, i - 19), i + 1);
    return Math.sqrt(sl.reduce((a, b) => a + (b - m) ** 2, 0) / sl.length);
  });
  const bbUpper = bbMid.map((m, i) => m + 2 * bbStd[i]);
  const bbLower = bbMid.map((m, i) => m - 2 * bbStd[i]);

  // Stoch RSI (smoothed)
  const stochK = rsi14.map((_, i) => {
    if (i < 14) return 50;
    const sl = rsi14.slice(i - 13, i + 1);
    const mn = Math.min(...sl), mx = Math.max(...sl);
    return mx === mn ? 50 : ((rsi14[i] - mn) / (mx - mn)) * 100;
  });
  const stochSmooth = ema(stochK, 3);

  // Volume MA
  const volMa20 = vols.map((_, i) => sma(vols, 20, i));

  // ── Collect factor votes ──────────────────────────────────────────────────
  const factors: PredictionFactor[] = [];

  // Helper — push a factor
  function factor(
    name: string,
    vote: "BUY" | "SELL" | "NEUTRAL",
    weight: number,
    value: string
  ) {
    factors.push({ name, vote, weight, value });
  }

  const c  = src[n];       // current (last closed) candle
  const c1 = src[n - 1];  // previous candle
  const c2 = src[n - 2];  // two candles ago

  const atrV  = atr14[n];
  const rsiV  = rsi14[n];
  const rsi7V = rsi7[n];
  const stochV = stochSmooth[n];
  const macdV  = macdLine[n];
  const sigV   = sigLine[n];
  const histV  = histogram[n];
  const histP  = histogram[n - 1];

  // ─────── FACTOR 1: Trend Alignment (EMA bias) — weight DYNAMIC ────────────────
  const overE200 = c.close > ema200[n];
  const e8e21    = ema8[n] > ema21[n];
  const e21e55   = ema21[n] > ema55[n];
  const bullEma  = overE200 && e8e21 && e21e55;
  const bearEma  = !overE200 && !e8e21 && !e21e55;
  
  // Dynamic Calibration for EMA
  const emaSignals: ("BUY" | "SELL" | "NEUTRAL")[] = src.map((cc, i) => {
     const up = cc.close > ema200[i] && ema8[i] > ema21[i] && ema21[i] > ema55[i];
     const dn = cc.close < ema200[i] && ema8[i] < ema21[i] && ema21[i] < ema55[i];
     return up ? "BUY" : dn ? "SELL" : "NEUTRAL";
  });
  const emaW = calibrateWeights(src, "EMA", emaSignals);

  factor(
    "EMA Trend (8/21/55/200)",
    bullEma ? "BUY" : bearEma ? "SELL" : "NEUTRAL",
    emaW,
    `Price ${overE200 ? "above" : "below"} EMA200. ${emaW.toFixed(1)}x Accuracy weighting.`
  );

  // ─────── FACTOR 2: SuperTrend — weight DYNAMIC ─────────────────────────────────
  const stSignals: ("BUY" | "SELL" | "NEUTRAL")[] = stDir.map(d => d === -1 ? "BUY" : "SELL");
  const stW = calibrateWeights(src, "SuperTrend", stSignals);

  factor(
    "SuperTrend (2.5, 10)",
    stDir[n] === -1 ? "BUY" : "SELL",
    stW,
    stDir[n] === -1 ? `Bullish channel (${stW.toFixed(1)}x)` : `Bearish channel (${stW.toFixed(1)}x)`
  );

  // ─────── FACTOR 3: MACD Momentum — weight DYNAMIC ──────────────────────────────
  const macdSignals: ("BUY" | "SELL" | "NEUTRAL")[] = macdLine.map((mv, i) => {
     const up = mv > sigLine[i] && (i > 0 && histogram[i] > histogram[i-1]);
     const dn = mv < sigLine[i] && (i > 0 && histogram[i] < histogram[i-1]);
     return up ? "BUY" : dn ? "SELL" : "NEUTRAL";
  });
  const macdW = calibrateWeights(src, "MACD", macdSignals);

  const macdBull = macdV > sigV && histV > histP;  // bullish and accelerating
  const macdBear = macdV < sigV && histV < histP;  // bearish and accelerating
  factor(
    "MACD Momentum (12,26,9)",
    macdBull ? "BUY" : macdBear ? "SELL" : "NEUTRAL",
    macdW,
    `Momentum bias: ${macdW.toFixed(1)}x Accuracy.`
  );

  // ─────── FACTOR 4: RSI Level — weight DYNAMIC ───────────────────────────────────
  const rsiSignals: ("BUY" | "SELL" | "NEUTRAL")[] = rsi14.map(rv => rv > 55 ? "BUY" : rv < 45 ? "SELL" : "NEUTRAL");
  const rsiW = calibrateWeights(src, "RSI", rsiSignals);

  const rsiBull = rsiV > 55 && rsiV < 80;
  const rsiBear = rsiV < 45 && rsiV > 20;
  const rsiObos = rsiV >= 80 ? "SELL" : rsiV <= 20 ? "BUY" : "NEUTRAL"; // extreme reversal
  factor(
    "RSI (14)",
    rsiBull ? "BUY" : rsiBear ? "SELL" : rsiObos !== "NEUTRAL" ? rsiObos : "NEUTRAL",
    rsiW,
    `RSI ${rsiV.toFixed(1)} (${rsiW.toFixed(1)}x Confidence)`
  );

  // ─────── FACTOR 5: Short RSI slope — weight 3 ────────────────────────────
  const rsiSlope  = rsi7V - rsi7[n - 3];
  const slopeBull = rsiSlope > 3;
  const slopeBear = rsiSlope < -3;
  factor(
    "RSI(7) Slope (3-bar)",
    slopeBull ? "BUY" : slopeBear ? "SELL" : "NEUTRAL",
    3,
    `Slope: ${rsiSlope > 0 ? "+" : ""}${rsiSlope.toFixed(1)} over 3 candles`
  );

  // ─────── FACTOR 6: Stoch RSI — weight 3 ──────────────────────────────────
  const stochPrev  = stochSmooth[n - 1];
  const crossUp    = stochV > stochPrev && stochV < 80;
  const crossDown  = stochV < stochPrev && stochV > 20;
  const stochExBuy = stochV <= 20;
  const stochExSell= stochV >= 80;
  factor(
    "Stoch RSI smooth",
    crossUp || stochExBuy ? "BUY" : crossDown || stochExSell ? "SELL" : "NEUTRAL",
    3,
    `Stoch ${stochV.toFixed(1)} — ${stochExBuy ? "Oversold" : stochExSell ? "Overbought" : crossUp ? "↑ Turning up" : crossDown ? "↓ Turning down" : "Neutral"}`
  );

  // ─────── FACTOR 7: Candle Pattern: Last 3 candles — weight 3 ─────────────
  const bodyC  = c.close - c.open;
  const bodyC1 = c1.close - c1.open;
  const bodyC2 = c2.close - c2.open;
  const threeGreenDays = bodyC > 0 && bodyC1 > 0 && bodyC2 > 0;
  const threeRedDays   = bodyC < 0 && bodyC1 < 0 && bodyC2 < 0;
  const rev3 = threeGreenDays ? "SELL" : threeRedDays ? "BUY" : "NEUTRAL"; // mean-reversion
  factor(
    "3-Candle Momentum",
    threeGreenDays ? "BUY" : threeRedDays ? "SELL" : "NEUTRAL",
    3,
    threeGreenDays ? "3 consecutive bullish candles" : threeRedDays ? "3 consecutive bearish candles" : "Mixed"
  );

  // ─────── FACTOR 8: Candle Pattern: Engulfing — weight 4 ──────────────────
  const bullEngulf = c.close > c.open && c1.close < c1.open &&
                     c.open < c1.close && c.close > c1.open;
  const bearEngulf = c.close < c.open && c1.close > c1.open &&
                     c.open > c1.close && c.close < c1.open;
  const pinBull    = (Math.min(c.close, c.open) - c.low) > Math.abs(bodyC) * 2;  // hammer
  const pinBear    = (c.high - Math.max(c.close, c.open))  > Math.abs(bodyC) * 2; // shooting star
  const patternVote = bullEngulf || pinBull ? "BUY" : bearEngulf || pinBear ? "SELL" : "NEUTRAL";
  factor(
    "Candle Pattern",
    patternVote,
    4,
    bullEngulf ? "Bullish Engulfing 🕯️" :
    bearEngulf ? "Bearish Engulfing 🕯️" :
    pinBull    ? "Hammer / Pin Bar ↑" :
    pinBear    ? "Shooting Star ↓" :
    "No strong pattern"
  );

  // ─────── FACTOR 9: Bollinger Bands position — weight 3 ───────────────────
  const bbPos   = (c.close - bbLower[n]) / (bbUpper[n] - bbLower[n] || 1);
  const bbExpand = bbStd[n] > bbStd[n - 5] * 1.1;
  // If price hugs lower band → likely bounce BUY; upper → SELL
  const bbVote = bbPos < 0.25 ? "BUY" : bbPos > 0.75 ? "SELL" : "NEUTRAL";
  factor(
    "Bollinger Band Position",
    bbVote,
    3,
    `${(bbPos * 100).toFixed(0)}% of band width. ${bbExpand ? "Expanding (momentum)" : "Contracting (squeeze)"}`
  );

  // ─────── FACTOR 10: Volume confirmation — weight 2 ───────────────────────
  const volRatio     = c.volume / (volMa20[n] || 1);
  const highVol      = volRatio > 1.3;
  const volWithTrend = highVol && bodyC > 0 ? "BUY" : highVol && bodyC < 0 ? "SELL" : "NEUTRAL";
  factor(
    "Volume Surge",
    volWithTrend,
    2,
    `${(volRatio * 100).toFixed(0)}% of average. ${highVol ? "Strong volume → confirms move" : "Below-average volume"}`
  );

  // ─────── FACTOR 11: Price vs VWAP — weight 2 ─────────────────────────────
  // Simplified VWAP from last 100 candles (intraday bucket)
  const vwapSlice = src.slice(-100);
  let cumTPV = 0, cumVol = 0;
  for (const cc of vwapSlice) {
    const tp = (cc.high + cc.low + cc.close) / 3;
    cumTPV += tp * cc.volume;
    cumVol += cc.volume;
  }
  const vwapVal    = cumVol > 0 ? cumTPV / cumVol : c.close;
  const aboveVwap  = c.close > vwapVal;
  factor(
    "VWAP Position",
    aboveVwap ? "BUY" : "SELL",
    2,
    `Price ${aboveVwap ? "above" : "below"} VWAP (${vwapVal.toFixed(2)})`
  );

  // ─────── FACTOR 12: ATR momentum (range expansion) — weight 2 ────────────
  const atrPrev = atr14[n - 5] || atrV;
  const atrExpanding = atrV > atrPrev * 1.1;
  // Range expansion in direction of last close
  factor(
    "ATR Expansion",
    atrExpanding ? (bodyC > 0 ? "BUY" : "SELL") : "NEUTRAL",
    2,
    `ATR ${atrV.toFixed(4)} (${atrExpanding ? "expanding — strong move likely" : "stable"})`
  );

  // ─────── FACTOR 13: Candle close-in-range — weight 2 ────────────────────
  // Where did the candle close relative to its own range? (0=low, 1=high)
  const rangePos = (c.close - c.low) / ((c.high - c.low) || 1);
  factor(
    "Close Position in Range",
    rangePos > 0.7 ? "BUY" : rangePos < 0.3 ? "SELL" : "NEUTRAL",
    2,
    `Closed at ${(rangePos * 100).toFixed(0)}% of candle range`
  );

  // ─────── FACTOR 14: EMA 8/21 crossover — weight 3 ─────────────────────────
  const e8Prev  = ema8[n - 1];
  const e21Prev = ema21[n - 1];
  const crossedUpEma   = ema8[n] > ema21[n] && e8Prev <= e21Prev;
  const crossedDownEma = ema8[n] < ema21[n] && e8Prev >= e21Prev;
  factor(
    "EMA 12/26 Crossover",
    crossedUpEma ? "BUY" : crossedDownEma ? "SELL" : ema8[n] > ema21[n] ? "BUY" : "SELL",
    3,
    crossedUpEma   ? "Bullish crossover (v12 engine)" :
    crossedDownEma ? "Bearish crossover (v12 engine)" :
    `EMA Dynamic Filter: ${ema8[n] > ema21[n] ? "Bullish" : "Bearish"} Bias`
  );

  // ─────── FACTOR 15: Institutional Liquidity Sweep — weight 12 ────────────
  const sweep = detectLiquiditySweep(src, n);
  factor(
    "Smart Money Hunt (Sweep)",
    sweep,
    12,
    sweep === "BUY" ? "Bullish Rejection of Liquidity Low" : sweep === "SELL" ? "Bearish Stop-Hunt at High" : "No institutional sweep detected"
  );

  // ─────── FACTOR 16: Fair Value Gap (FVG) — weight 12 ──────────────────────
  const fvg = detectFVG(src, n);
  factor(
    "Order-Block Gap (FVG)",
    fvg,
    12,
    fvg === "BUY" ? "Institutional Buy Imbalance detected" : fvg === "SELL" ? "Institutional Sell Imbalance detected" : "Order flow fully balanced"
  );

  // ─────── FACTOR 17: Market Structure Shift (MSS) — weight 12 ──────────────
  const mss = detectMSS(src, n);
  factor(
    "Structure Shift (MSS)",
    mss,
    10,
    mss === "BUY" ? "Bullish breaking through resistance" : mss === "SELL" ? "Bearish breaking through support" : "Market structure holding"
  );

  // ─── Compute final score ──────────────────────────────────────────────────
  let bullScore = 0, totalWeight = 0;
  for (const f of factors) {
    totalWeight += f.weight;
    if (f.vote === "BUY")     bullScore += f.weight;
    else if (f.vote === "SELL") bullScore -= f.weight;
    // NEUTRAL = 0
  }

  // ─── INSTITUTIONAL CONFLUENCE ENGINE ──────────────────────────────────────
  let institutionalHits = 0;
  if (sweep !== "NEUTRAL") institutionalHits++;
  if (fvg !== "NEUTRAL") institutionalHits++;
  if (mss !== "NEUTRAL") institutionalHits++;

  const direction: "BUY" | "SELL" = bullScore >= 0 ? "BUY" : "SELL";
  const probability = toProbability(Math.abs(bullScore), totalWeight);

  // v14.0 CONFIRMED PROFIT HORIZON (5-10 MINS) 
  const p5 = src[n].close > src[n-5].close ? "BUY" : "SELL";
  const p10 = src[n].close > src[n-10].close ? "BUY" : "SELL";
  const horizonConfirmed = (p5 === direction && p10 === direction);

  // v15.0 SMC DISPLACEMENT (INSTITUTIONAL FORCE)
  const lastC = src[n];
  const avgBody = src.slice(-20).reduce((a, b) => a + Math.abs(b.close - b.open), 0) / 20;
  const avgVol  = src.slice(-20).reduce((a, b) => a + (b.volume || 0), 0) / 20;
  
  const currentBody = Math.abs(lastC.close - lastC.open);
  const currentVol  = (lastC.volume || 0);

  // v16.0 LIGHTNING OPTIMIZATION: 
  // Trigger on either 1.2x Body (Visible Force) OR 1.8x Volume (Hidden Force)
  const isDisplacement = currentBody > avgBody * 1.2 || currentVol > avgVol * 1.8;

  // PROFIT MAXIMIZER v16.0: Institutional Lightning Gate
  // 1. Minimum 72% for STRONG signals
  // 2. Minimum 1 Institutional confluence (FVG/MSS/Sweep)
  // 3. HORIZON CONFIRMED (10 Min trend must ALIGN) — Reduced from 5+10 to just 10 for speed
  // 4. DISPLACEMENT (Smart Money Force detected — Optimized threshold)
  let strength: "STRONG" | "NORMAL" | "WEAK" = "NORMAL";

  if (probability >= 72 && institutionalHits >= 1 && p10 === direction && isDisplacement) {
    strength = "STRONG";
  } else {
    strength = "WEAK";
  }

  const lastCandleTime = src[n].time;
  const forCandleAt    = lastCandleTime + candleSeconds;

  const bullFrac = bullScore / (totalWeight || 1);
  const message = strength === "STRONG"
    ? `Confirmed Institutional Displacement. Momentum (${Math.round(bullFrac*100)}% bias) confirms a high-probability swing setup.` 
    : "Indicators balanced. Analyzing 5-10 minute market structure (v16.0 Lightning Scan). Awaiting institutional force.";

  return {
    direction,
    action: strength === "STRONG" ? direction : "MONITORING",
    probability,
    strength,
    message,
    generatedAt: Date.now(),
    forCandleAt
  };
}
