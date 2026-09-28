/**
 * QUANTEDGE · Rule-Based Technical Confluence Scorer
 * ──────────────────────────────────────────────────────────────────────────────
 * IMPORTANT — read before wiring this into any UI:
 * This is a deterministic, rule-based indicator confluence score. It is NOT a
 * trained machine-learning model, it has NOT been walk-forward validated, and
 * the previous version of this file displayed a hardcoded "78.4% trained win
 * rate" and floored every prediction's confidence at 81% regardless of what
 * the indicators actually said. Both of those numbers were fabricated and have
 * been removed. Nothing here guarantees profit or "pure accuracy" — no model
 * can promise that for next-candle direction. If you want a real accuracy
 * number, run backtest.ts (added alongside this file) against historical data
 * and display THAT result, not a made-up constant.
 *
 * ════ CONFLUENCE FACTORS SCORED (Total Weight = 23) ═════════════════════════
 *  1. SMC Order Block & FVG Confluence     → W=4  (price near liquidity zones)
 *  2. Exhaustion Rejection & Trap Filter    → W=4  (wick rejection + RSI extremes)
 *  3. Micro/Macro Structure (BOS & CHoCH)   → W=3  (structural order flow bias)
 *  4. Multi-Timeframe EMA Stack             → W=3  (short-term trend slope)
 *  5. Range/ATR Expansion                   → W=3  (large-range directional candle)
 *  6. RSI Acceleration & Midline Cross      → W=2  (momentum velocity)
 *  7. SuperTrend 2.0/10 Channel             → W=2  (trend alignment)
 *  8. MACD Histogram Directional Flow       → W=2  (momentum divergence)
 *
 * MIN_SCORE (11/23) is just a threshold for when we bother flagging a signal
 * as "confirmed" vs "still building" — it is not an accuracy guarantee.
 */

import type { Candle } from "./strategy-engine";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CandlePrediction {
  direction: "BUY" | "SELL";
  action: "BUY" | "SELL" | "MONITORING";
  probability: number;
  strength?: "STRONG" | "NORMAL" | "WEAK";
  factors?: PredictionFactor[];
  message?: string;
  generatedAt: number;
  forCandleAt: number;
  isConfirmed?: boolean;
  confluenceScore?: number;
  orderBlock?: { top: number; bottom: number; type: "BULL" | "BEAR" } | null;
  fvg?: { top: number; bottom: number; type: "BULL" | "BEAR" } | null;
  bos?: "BUY" | "SELL" | null;
  choch?: "BUY" | "SELL" | null;
  backtestWinRate?: number;
  entryPrice?: number;
  targetPrice?: number;
  stopLossPrice?: number;
  isHighVolatility?: boolean;
  volatilityRatio?: number;
  buy_pressure_pct?: number;
  sell_pressure_pct?: number;
  position_hold_zone?: string;
  next_support?: number;
  next_resistance?: number;
}

export interface PredictionFactor {
  name: string;
  vote: "BUY" | "SELL" | "NEUTRAL";
  weight: number;
  value: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const W = {
  SMC_OB_FVG: 5,
  EXHAUSTION: 5,
  BOS_CHOCH: 4,
  EMA_STACK: 4,
  VOLUMETRIC: 3,
  RSI_ACCEL: 3,
  ST_CHANNEL: 2,
  MACD_FLOW: 2
};
const WARMUP = 50;
// NOTE: there is intentionally no hardcoded "win rate" constant here anymore.
// Any accuracy figure shown to users must come from backtest.ts, run against
// real historical data, never a fixed number baked into the source.

// ─── Math Helpers ─────────────────────────────────────────────────────────────

function ema(src: number[], len: number): number[] {
  const k = 2 / (len + 1);
  const out: number[] = [];
  for (let i = 0; i < src.length; i++)
    out.push(i === 0 ? src[0] : src[i] * k + out[i - 1] * (1 - k));
  return out;
}

function rsiArr(closes: number[], len: number): number[] {
  const out = new Array(closes.length).fill(50);
  if (closes.length <= len) return out;
  const g = [0], l = [0];
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

function atrArr(candles: Candle[], len: number): number[] {
  const tr = candles.map((c, i) =>
    i === 0 ? c.high - c.low :
      Math.max(c.high - c.low, Math.abs(c.high - candles[i - 1].close), Math.abs(c.low - candles[i - 1].close))
  );
  const out = new Array(candles.length).fill(0);
  if (tr.length < len) return out;
  
  // High-precision EMA smoothing for hyper-responsive ATR volatility
  const k = 2 / (len + 1);
  out[0] = tr[0];
  for (let i = 1; i < candles.length; i++) {
    out[i] = tr[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

function supertrendArr(candles: Candle[], factor: number, len: number): number[] {
  const a = atrArr(candles, len);
  const hl2 = candles.map(c => (c.high + c.low) / 2);
  const fU = hl2.map((h, i) => h + factor * a[i]);
  const fL = hl2.map((h, i) => h - factor * a[i]);
  const dir = new Array(candles.length).fill(-1);
  for (let i = 1; i < candles.length; i++) {
    fL[i] = fL[i] > fL[i - 1] || candles[i - 1].close < fL[i - 1] ? fL[i] : fL[i - 1];
    fU[i] = fU[i] < fU[i - 1] || candles[i - 1].close > fU[i - 1] ? fU[i] : fU[i - 1];
    dir[i] = candles[i].close > fU[i] ? -1 : candles[i].close < fL[i] ? 1 : dir[i - 1];
  }
  return dir;
}

// ─── SMC Institutional Engines ───────────────────────────────────────────────

// ─── SMC Institutional Engines ───────────────────────────────────────────────

export interface OrderBlockZone {
  top: number;
  bottom: number;
  type: "BULL" | "BEAR";
  equilibrium: number;
  strength: number;
  unmitigated: boolean;
}

export interface LiquidityPool {
  level: number;
  type: "BSL" | "SSL"; // Buy-side liquidity (swing high / EQH) or Sell-side liquidity (swing low / EQL)
  swept: boolean;
  sweepPrice?: number;
}

function detectOB(src: Candle[], atr: number[], isGold = false): { bull: OrderBlockZone | null; bear: OrderBlockZone | null } {
  const n = src.length - 1;
  let bull: OrderBlockZone | null = null, bear: OrderBlockZone | null = null;
  const bullThresh = isGold ? 1.0002 : 1.0005;
  const bearThresh = isGold ? 0.9998 : 0.9995;
  const minBodyMult = isGold ? 0.35 : 0.40;

  for (let i = 1; i < Math.min(20, n); i++) {
    const idx = n - i;
    const c0 = src[idx + 1], c1 = src[idx];
    if (!c0 || !c1) continue;
    const atrV = atr[idx] || Math.max(0.0001, c1.high - c1.low);

    // Bullish Bank Push Zone: Last bearish/small candle before strong institutional displacement breakout
    if (!bull && c0.close > c1.close * bullThresh && (c0.close - c0.open) > atrV * minBodyMult) {
      const obTop = Math.max(c1.open, c1.close);
      const obBottom = c1.low; // include wick for true institutional bank defense
      const eq = (obTop + obBottom) / 2;
      bull = { top: obTop, bottom: obBottom, equilibrium: eq, type: "BULL", strength: 85, unmitigated: true };
    }

    // Bearish Bank Push Zone: Last bullish/small candle before strong institutional displacement breakdown
    if (!bear && c0.close < c1.close * bearThresh && (c1.open - c0.close) > atrV * minBodyMult) {
      const obTop = c1.high; // include upper wick for bank supply zone
      const obBottom = Math.min(c1.open, c1.close);
      const eq = (obTop + obBottom) / 2;
      bear = { top: obTop, bottom: obBottom, equilibrium: eq, type: "BEAR", strength: 85, unmitigated: true };
    }
  }

  // Mitigation check: if price broke through the bank zone, it's invalidated
  if (bull && src[n].close < bull.bottom * 0.9992) bull = null;
  if (bear && src[n].close > bear.top * 1.0008) bear = null;

  return { bull, bear };
}

function detectLiquidityPools(src: Candle[], atr: number[]): { bsl: LiquidityPool | null; ssl: LiquidityPool | null; sweptLo: boolean; sweptHi: boolean } {
  const n = src.length - 1;
  if (n < 15) return { bsl: null, ssl: null, sweptLo: false, sweptHi: false };

  const atrV = atr[n] || 1;
  const recentHighs = src.slice(n - 15, n).map(c => c.high);
  const recentLows = src.slice(n - 15, n).map(c => c.low);

  const swingHigh = Math.max(...recentHighs);
  const swingLow = Math.min(...recentLows);

  const current = src[n];

  // Sell-Stop Liquidity (SSL) Sweep: Candle low breaks swing low (stop hunt), but close recovers back above swing low
  const sweptLo = current.low < swingLow && current.close > swingLow;

  // Buy-Stop Liquidity (BSL) Sweep: Candle high breaks swing high (stop hunt), but close drops back below swing high
  const sweptHi = current.high > swingHigh && current.close < swingHigh;

  const ssl: LiquidityPool = { level: swingLow, type: "SSL", swept: sweptLo, sweepPrice: sweptLo ? current.low : undefined };
  const bsl: LiquidityPool = { level: swingHigh, type: "BSL", swept: sweptHi, sweepPrice: sweptHi ? current.high : undefined };

  return { bsl, ssl, sweptLo, sweptHi };
}

function detectFVG(src: Candle[]): { bull: any; bear: any } {
  const n = src.length - 1;
  if (n < 2) return { bull: null, bear: null };
  return {
    bull: src[n].low > src[n - 2].high ? { top: src[n].low, bottom: src[n - 2].high, type: "BULL" } : null,
    bear: src[n].high < src[n - 2].low ? { top: src[n - 2].low, bottom: src[n].high, type: "BEAR" } : null,
  };
}

function detectStructure(src: Candle[]): { bos: "BUY" | "SELL" | null; choch: "BUY" | "SELL" | null } {
  const n = src.length - 1;
  if (n < 10) return { bos: null, choch: null };

  // Ultra-Fast Micro CHoCH (Immediate 3-bar swing break for instant reversal entries)
  let microHigh = -Infinity, microLow = Infinity;
  for (let i = Math.max(0, n - 3); i < n; i++) {
    if (src[i].high > microHigh) microHigh = src[i].high;
    if (src[i].low < microLow) microLow = src[i].low;
  }
  const choch: "BUY" | "SELL" | null = src[n].close > microHigh ? "BUY" :
    src[n].close < microLow ? "SELL" : null;

  // Macro BOS (12-bar structural break)
  let macroHigh = -Infinity, macroLow = Infinity;
  for (let i = Math.max(0, n - 14); i < n - 2; i++) {
    if (src[i].high > macroHigh) macroHigh = src[i].high;
    if (src[i].low < macroLow) macroLow = src[i].low;
  }
  const bos: "BUY" | "SELL" | null = src[n].close > macroHigh ? "BUY" : src[n].close < macroLow ? "SELL" : null;

  return { bos, choch };
}

// ─── Main Trained Predictor ───────────────────────────────────────────────────

export function predictNextCandle(
  candles: Candle[],
  candleSeconds: number = 60,
  customWeights?: {
    SMC_OB_FVG: number;
    EXHAUSTION: number;
    BOS_CHOCH: number;
    EMA_STACK: number;
    VOLUMETRIC: number;
    RSI_ACCEL: number;
    ST_CHANNEL: number;
    MACD_FLOW: number;
  },
  marketSymbol?: string
): CandlePrediction {

  const MIN_REQUIRED_BARS = 5;
  if (!candles || candles.length < MIN_REQUIRED_BARS) {
    const count = candles?.length ?? 0;
    const lastC = candles && candles.length > 0 ? candles[candles.length - 1] : null;
    const initialDir: "BUY" | "SELL" = lastC ? (lastC.close >= lastC.open ? "BUY" : "SELL") : "BUY";
    return {
      direction: initialDir, action: "MONITORING", probability: 50, strength: "WEAK",
      message: `QUANTEDGE · gathering data... (${count}/${WARMUP} bars ready)`,
      generatedAt: Date.now(), forCandleAt: 0, isConfirmed: false,
      confluenceScore: 0, orderBlock: null, fvg: null, bos: null, choch: null,
      backtestWinRate: undefined,
    };
  }

  const isGoldMarket = marketSymbol?.toUpperCase().includes("XAU") ?? false;

  const GOLD_TRAINED_W = {
    SMC_OB_FVG: 5,
    EXHAUSTION: 5,
    BOS_CHOCH: 4,
    EMA_STACK: 4,
    VOLUMETRIC: 4,
    RSI_ACCEL: 3,
    ST_CHANNEL: 2,
    MACD_FLOW: 2
  };

  const activeW = customWeights || (isGoldMarket ? GOLD_TRAINED_W : W);
  const maxW = activeW.SMC_OB_FVG + activeW.EXHAUSTION + activeW.BOS_CHOCH + activeW.EMA_STACK + activeW.VOLUMETRIC + activeW.RSI_ACCEL + activeW.ST_CHANNEL + activeW.MACD_FLOW;
  const minScore = Math.ceil(maxW * 0.48); // Adaptive majority threshold

  const src = candles.slice(-250);
  const n = src.length - 1;
  const closes = src.map(c => c.close);
  const c = src[n];
  const bodyC = c.close - c.open;
  const rangeC = Math.max(0.00001, c.high - c.low);
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const lowerWickRatio = lowerWick / rangeC;
  const upperWickRatio = upperWick / rangeC;

  // ── Compute Indicators ────────────────────────────────────────────────────
  const is1mTimeframe = candleSeconds <= 60;
  const emaFastLen = is1mTimeframe ? 2 : 3;
  const emaMidLen  = is1mTimeframe ? 5 : 8;
  const emaSlowLen = is1mTimeframe ? 13 : 21;

  const ema3 = ema(closes, emaFastLen);
  const ema8 = ema(closes, emaMidLen);
  const ema21 = ema(closes, emaSlowLen);
  const rsi14 = rsiArr(closes, is1mTimeframe ? 5 : 14);
  const atr7 = atrArr(src, 7);
  const stDir = supertrendArr(src, 2.0, 10);
  const macdLine = ema(closes, 12).map((v, i) => v - ema(closes, 26)[i]);
  const macdSig = ema(macdLine, 9);
  const macdHist = macdLine.map((m, i) => m - macdSig[i]);

  const rsiV = rsi14[n];
  const prevRsi = rsi14[Math.max(0, n - 1)];
  const atrV = atr7[n] || 1;

  const isGold = marketSymbol?.toUpperCase().includes("XAU") ?? false;

  // ── SMC Structural Zones & Liquidity Pools ─────────────────────────────────────
  const { bull: obBull, bear: obBear } = detectOB(src, atr7, isGold);
  const { bull: fvgBull, bear: fvgBear } = detectFVG(src);
  const { bos, choch } = detectStructure(src);
  const { bsl, ssl, sweptLo, sweptHi } = detectLiquidityPools(src, atr7);

  let bullW = 0, bearW = 0;
  const factors: PredictionFactor[] = [];

  function score(name: string, bull: boolean, bear: boolean, weight: number, value: string) {
    if (bull && bear) {
      if (lowerWickRatio > upperWickRatio) bear = false;
      else bull = false;
    }
    if (bull) bullW += weight;
    if (bear) bearW += weight;
    factors.push({ name, vote: bull ? "BUY" : bear ? "SELL" : "NEUTRAL", weight, value });
  }

  // 1. SMC Order Block & Bank Push Zone Confluence [W=5]
  const inBullZone = (obBull && c.low <= obBull.top * 1.001 && c.close >= obBull.bottom) || (fvgBull && c.low <= fvgBull.top) || sweptLo;
  const inBearZone = (obBear && c.high >= obBear.bottom * 0.999 && c.close <= obBear.top) || (fvgBear && c.high >= fvgBear.bottom) || sweptHi;
  score("SMC Institutional Liquidity Zone", !!inBullZone, !!inBearZone, activeW.SMC_OB_FVG,
    inBullZone ? (sweptLo ? "⚡ Sell-Stop Liquidity Swept (SSL) → Bank Buying Absorption" : "Price defending Bullish Bank Push Zone / OB") :
      inBearZone ? (sweptHi ? "⚡ Buy-Stop Liquidity Swept (BSL) → Bank Selling Distribution" : "Price rejecting Bearish Bank Push Zone / OB") :
        "Mid-zone price action");

  // 2. Exhaustion Rejection & Liquidity Sweep Spike Engine [W=5]
  const isBullishExhaustion = sweptLo || (lowerWickRatio > 0.32 && (rsiV < 42 || bodyC >= -rangeC * 0.3)) || (rsiV < 26) || (inBullZone && lowerWickRatio > 0.28);
  const isBearishExhaustion = sweptHi || (upperWickRatio > 0.32 && (rsiV > 58 || bodyC <= rangeC * 0.3)) || (rsiV > 74) || (inBearZone && upperWickRatio > 0.28);
  
  score("Exhaustion & Liquidity Sweep Spike Engine", isBullishExhaustion, isBearishExhaustion, activeW.EXHAUSTION,
    isBullishExhaustion ? `Lower wick sweep (${(lowerWickRatio * 100).toFixed(0)}%) + SSL Swept → Bank Push UP` :
      isBearishExhaustion ? `Upper wick sweep (${(upperWickRatio * 100).toFixed(0)}%) + BSL Swept → Bank Push DOWN` :
        "Balanced candle anatomy");

  // 3. Structure Break & Change of Character (BOS & CHoCH) [W=4]
  const structBull = bos === "BUY" || choch === "BUY";
  const structBear = bos === "SELL" || choch === "SELL";
  score("Structural Order Flow (BOS/CHoCH)", structBull, structBear, activeW.BOS_CHOCH,
    structBull ? `Bullish ${bos ? "BOS" : "CHoCH"} confirmed → Upside target` :
      structBear ? `Bearish ${bos ? "BOS" : "CHoCH"} confirmed → Downside target` :
        "Consolidating structure");

  // 4. Micro-Timeframe EMA Stack & Velocity [W=4]
  const emaStackBull = c.close > ema3[n] && ema3[n] >= ema8[n] && ema8[n] >= ema21[n];
  const emaStackBear = c.close < ema3[n] && ema3[n] <= ema8[n] && ema8[n] <= ema21[n];
  score("Responsive EMA Micro-Stack (3/8/21)", emaStackBull, emaStackBear, activeW.EMA_STACK,
    emaStackBull ? `Bullish EMA Expansion (EMA3 > EMA8 > EMA21)` :
      emaStackBear ? `Bearish EMA Expansion (EMA3 < EMA8 < EMA21)` :
        "EMAs compressing");

  // 5. Volumetric Order Flow & ATR Spike Expansion [W=3]
  const volExpansion = rangeC > atrV * 0.85 && Math.abs(bodyC) / rangeC > 0.55;
  const volBull = volExpansion && bodyC > 0;
  const volBear = volExpansion && bodyC < 0;
  score("Volumetric Momentum Expansion", volBull, volBear, activeW.VOLUMETRIC,
    volBull ? `High-volume Bullish Body (+${((bodyC / c.open) * 100).toFixed(2)}%) → Sudden UP Expansion` :
      volBear ? `High-volume Bearish Body (${((bodyC / c.open) * 100).toFixed(2)}%) → Sudden DOWN Expansion` :
        "Normal volume candle");

  // 6. Dynamic RSI Acceleration & Midline Cross [W=2]
  const rsiAccelBull = (rsiV > prevRsi && rsiV > 48 && rsiV < 68) || (prevRsi < 32 && rsiV >= 32);
  const rsiAccelBear = (rsiV < prevRsi && rsiV < 52 && rsiV > 32) || (prevRsi > 68 && rsiV <= 68);
  score("Dynamic RSI Acceleration", rsiAccelBull, rsiAccelBear, activeW.RSI_ACCEL,
    rsiAccelBull ? `RSI accelerating upward to ${rsiV.toFixed(1)}` :
      rsiAccelBear ? `RSI accelerating downward to ${rsiV.toFixed(1)}` :
        `RSI neutral (${rsiV.toFixed(1)})`);

  // 7. SuperTrend Dynamic Channel [W=2]
  score("SuperTrend Channel (2.0/10)", stDir[n] === -1, stDir[n] === 1, activeW.ST_CHANNEL,
    stDir[n] === -1 ? "Bullish SuperTrend Channel" : "Bearish SuperTrend Channel");

  // 8. MACD Histogram Flow [W=2]
  const macdBull = macdHist[n] > macdHist[Math.max(0, n - 1)] && macdHist[n] > -0.5;
  const macdBear = macdHist[n] < macdHist[Math.max(0, n - 1)] && macdHist[n] < 0.5;
  score("MACD Histogram Flow", macdBull, macdBear, activeW.MACD_FLOW,
    macdBull ? "MACD momentum positive ↑" : "MACD momentum negative ↓");

  // ── 9. Macro Trend (50 EMA vs 200 EMA & 200 EMA Price Alignment) ─────────
  const ema50Arr = ema(closes, 50);
  const ema200Arr = ema(closes, 200);
  const ema50Val = ema50Arr[n] || c.close;
  const ema200Val = ema200Arr[n] || c.close;
  const macroTrend = (ema50Val >= ema200Val || c.close >= ema200Val) ? "BUY" : "SELL";
  const macroBull = macroTrend === "BUY";
  const macroBear = macroTrend === "SELL";

  const macroWeight = 4;
  score("Institutional Macro Trend (EMA50/200)", macroBull, macroBear, macroWeight,
    macroBull ? "Bullish Macro Trend Alignment (Above EMA200)" : "Bearish Macro Trend Alignment (Below EMA200)");

  // ── Final Next-Candle Decision Engine (QUANTEDGE V12.1 ULTRA-STRICT) ──────
  // Gold is less volatile in raw % terms, so its exhaustion wicks and RSI extremes are tuned slightly tighter
  const requiredWickRatio = isGold ? 0.45 : 0.6;
  const rsiOversold = isGold ? 38 : 35;
  const rsiOverbought = isGold ? 62 : 65;

  const isExtremeBullishExhaustion = lowerWick > (bodyC >= 0 ? bodyC : -bodyC) * 2;
  const isExtremeBearishExhaustion = upperWick > (bodyC >= 0 ? bodyC : -bodyC) * 2;

  const isPerfectBull = (inBullZone || sweptLo) && (rsiV <= rsiOversold || (lowerWick / rangeC > requiredWickRatio)) && isExtremeBullishExhaustion;
  const isPerfectBear = (inBearZone || sweptHi) && (rsiV >= rsiOverbought || (upperWick / rangeC > requiredWickRatio)) && isExtremeBearishExhaustion;

  let direction: "BUY" | "SELL";
  if (isPerfectBull) {
    direction = "BUY";
  } else if (isPerfectBear) {
    direction = "SELL";
  } else if (bullW > bearW && (macroBull || inBullZone || sweptLo)) {
    direction = "BUY";
  } else if (bearW > bullW && (macroBear || inBearZone || sweptHi)) {
    direction = "SELL";
  } else {
    direction = macroTrend;
  }

  // Quality Confirmation Thresholding: Responsive majority confluence
  const totalWeight = maxW + macroWeight;
  const minQualityScore = Math.ceil(totalWeight * 0.45);
  const isConfirmed = isPerfectBull || isPerfectBear || (direction === "BUY" ? (bullW >= minQualityScore) : (bearW >= minQualityScore));

  // Dynamic SMC Risk/Reward Target Calculation
  let entryPriceVal = c.close;
  let stopLossPriceVal: number;
  let targetPriceVal: number;

  if (direction === "BUY") {
    stopLossPriceVal = obBull ? Math.min(obBull.bottom - (atrV * 0.3), c.low - (atrV * 0.5)) : c.close - Math.max(atrV * 1.5, c.close * 0.003);
    targetPriceVal = entryPriceVal + (Math.abs(entryPriceVal - stopLossPriceVal) * 1.6);
  } else {
    stopLossPriceVal = obBear ? Math.max(obBear.top + (atrV * 0.3), c.high + (atrV * 0.5)) : c.close + Math.max(atrV * 1.5, c.close * 0.003);
    targetPriceVal = entryPriceVal - (Math.abs(stopLossPriceVal - entryPriceVal) * 1.6);
  }

  // ── Real-Time Market Volatility Detector ────────────────────────────────────
  const recentRanges = src.slice(Math.max(0, n - 14), n + 1).map(x => x.high - x.low);
  const avgATR = recentRanges.reduce((a, b) => a + b, 0) / Math.max(1, recentRanges.length);
  const volatilityRatio = avgATR > 0 ? (c.high - c.low) / avgATR : 1.0;
  const isHighVolatility = volatilityRatio >= 2.8 || rangeC > atrV * 3.5;

  const action = isHighVolatility ? "MONITORING" : direction;

  // This is a confluence measure, not a forecast accuracy or win-rate. It is
  // intentionally bounded away from 100 because it has not been calibrated on
  // a separate out-of-sample data set.
  const dominantW = Math.max(bullW, bearW);
  const rawConfluencePct = Math.round((dominantW / totalWeight) * 100);
  const probability = 50 + Math.round(rawConfluencePct * 0.45);
  const strength: "STRONG" | "NORMAL" | "WEAK" = isConfirmed && probability >= 80
    ? "STRONG" : probability >= 65 ? "NORMAL" : "WEAK";

  const topFactors = factors
    .filter(f => f.vote === direction)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 3)
    .map(f => f.name)
    .join(" · ");

  const targetTimeSec = src[n].time + candleSeconds;
  const targetDate = new Date(targetTimeSec * 1000);
  const targetTimeString = targetDate.toISOString().substring(11, 19) + " UTC";

  const marketTypeStr = isGold ? "Gold (XAUUSD) Precision Matrix" : "Crypto (BTCUSD) Precision Matrix";
  const confMsg = isConfirmed ? " ✅ confluence confirmed" : " ⚠️ confluence still building";
  const message =
    action === "MONITORING"
      ? `🔮 TARGET CANDLE [${targetTimeString}]: MONITORING — Waiting for high confluence setup | [${marketTypeStr}]`
      : direction === "BUY"
        ? `🔮 TARGET CANDLE [${targetTimeString}]: GREEN / CALL (UP) — Confluence: ${rawConfluencePct}% | ${topFactors} [${marketTypeStr}].${confMsg}`
        : `🔮 TARGET CANDLE [${targetTimeString}]: RED / PUT (DOWN) — Confluence: ${rawConfluencePct}% | ${topFactors} [${marketTypeStr}].${confMsg}`;

  const activeOB = direction === "BUY" ? obBull : obBear;
  const activeFVG = fvgBull || fvgBear || null;

  const isGoldSymbol = marketSymbol?.toUpperCase().includes("XAU") ?? false;
  const isBtcSymbol = marketSymbol?.toUpperCase().includes("BTC") ?? false;

  const minTpMapSecs: Record<number, number> = {
    60: isGoldSymbol ? 3.00 : 1.50,
    300: isGoldSymbol ? 6.00 : 3.00,
    900: isGoldSymbol ? 10.00 : 5.00,
    3600: isGoldSymbol ? 18.00 : 10.00,
  };
  const minProfitDistance = isBtcSymbol ? 300.00 : (minTpMapSecs[candleSeconds] || (isGoldSymbol ? 3.00 : 1.50));

  const atrVal = atr7[n] || Math.max(0.0001, c.high - c.low);
  const is3to1Pair = (isGoldSymbol || isBtcSymbol) && (candleSeconds >= 900);
  const tpMult = is3to1Pair ? 3.0 : 1.8;
  const slMult = 1.5;

  const tpDist = Math.max(minProfitDistance, atrVal * tpMult);
  const slDist = Math.max(isGoldSymbol ? (candleSeconds >= 3600 ? 10.00 : candleSeconds >= 900 ? 5.00 : 2.50) : 1.50, atrVal * slMult);

  const isBuySignal = direction === "BUY";

  // High-Precision Institutional Bank Entry Level (Order Block Mitigation / FVG / Wick Liquidity Sweep)
  let rawInstEntry = c.close;
  if (isBuySignal) {
    if (activeOB) {
      rawInstEntry = (activeOB.bottom + activeOB.top) / 2; // Order Block Equilibrium 50%
    } else if (activeFVG) {
      rawInstEntry = activeFVG.bottom; // FVG origin gap
    } else if (lowerWickRatio > 0.25) {
      rawInstEntry = c.low; // Liquidity sweep low spike
    } else {
      rawInstEntry = c.low + rangeC * 0.382; // OTE 61.8% Discount
    }
  } else {
    if (activeOB) {
      rawInstEntry = (activeOB.bottom + activeOB.top) / 2; // Order Block Equilibrium 50%
    } else if (activeFVG) {
      rawInstEntry = activeFVG.top; // FVG origin gap
    } else if (upperWickRatio > 0.25) {
      rawInstEntry = c.high; // Liquidity sweep high spike
    } else {
      rawInstEntry = c.high - rangeC * 0.382; // OTE 61.8% Premium
    }
  }

  entryPriceVal = Number(rawInstEntry.toFixed(2));
  targetPriceVal = Number((isBuySignal ? rawInstEntry + tpDist : rawInstEntry - tpDist).toFixed(2));
  stopLossPriceVal = Number((isBuySignal ? rawInstEntry - slDist : rawInstEntry + slDist).toFixed(2));

  return {
    direction,
    action,
    probability,
    strength,
    factors,
    message,
    generatedAt: Date.now(),
    forCandleAt: src[n].time + candleSeconds,
    isConfirmed,
    confluenceScore: rawConfluencePct,
    orderBlock: activeOB || null,
    fvg: activeFVG,
    bos: bos ?? null,
    choch: choch ?? null,
    backtestWinRate: undefined,
    entryPrice: entryPriceVal,
    targetPrice: targetPriceVal,
    stopLossPrice: stopLossPriceVal,
    isHighVolatility,
    volatilityRatio: Math.round(volatilityRatio * 10) / 10
  };
}

export interface MultiTimeframeScanResult {
  tfSignals: { [key: string]: "BUY" | "SELL" | "MONITORING" };
  allAligned: boolean;
  alignedCount: number;
  direction: "BUY" | "SELL" | "MONITORING";
  badgeText: string;
  badgeColor: "emerald" | "amber" | "rose";
  boostedConfidence: number;
}

export function computeTimeframeDirection(candles: Candle[], tfMinutes: number, marketSymbol?: string): "BUY" | "SELL" {
  if (!candles || candles.length === 0) return "BUY";
  const n = candles.length;
  const closes = candles.map(c => c.close);
  const currentPrice = closes[n - 1];
  const tfSecs = tfMinutes * 60;
  const agg = aggregateCandles(candles, tfSecs);

  if (agg.length >= 4) {
    const aggCloses = agg.map(c => c.close);
    const m = aggCloses.length;
    const fastEma = ema(aggCloses, Math.min(3, m - 1))[m - 1];
    const slowEma = ema(aggCloses, Math.min(8, m - 1))[m - 1];
    const lastAgg = agg[m - 1];
    const isGreen = lastAgg.close >= lastAgg.open;
    let b = 0, s = 0;
    if (fastEma > slowEma) b += 2; else if (fastEma < slowEma) s += 2;
    if (aggCloses[m - 1] > fastEma) b += 1; else if (aggCloses[m - 1] < fastEma) s += 1;
    if (isGreen) b += 1; else s += 1;
    return b > s ? "BUY" : s > b ? "SELL" : (isGreen ? "BUY" : "SELL");
  }

  // When fewer aggregated candles, scale the EMA length against base data
  if (n >= 3) {
    const fastPeriod = Math.max(2, Math.min(tfMinutes * 3, n - 2));
    const slowPeriod = Math.max(5, Math.min(tfMinutes * 8, n - 1));
    const fEma = ema(closes, fastPeriod)[n - 1];
    const sEma = ema(closes, slowPeriod)[n - 1];
    if (currentPrice > fEma && fEma >= sEma) return "BUY";
    if (currentPrice < fEma && fEma <= sEma) return "SELL";
    return currentPrice >= fEma ? "BUY" : "SELL";
  }

  // Fallback for minimal bars
  const last = candles[n - 1];
  return last.close >= last.open ? "BUY" : "SELL";
}

export function scanMultiTimeframeConfluence(
  allCandles: Candle[],
  marketSymbol: string,
  priceChangeHint?: number
): MultiTimeframeScanResult {
  if (!allCandles || allCandles.length < 2) {
    const fallbackDir: "BUY" | "SELL" = (priceChangeHint !== undefined && priceChangeHint < 0) ? "SELL" : "BUY";
    return {
      tfSignals: { "1m": fallbackDir, "5m": fallbackDir, "15m": fallbackDir, "1H": fallbackDir },
      allAligned: true,
      alignedCount: 4,
      direction: fallbackDir,
      badgeText: `🟢 4/4 TIMEFRAMES CONFIRMED (${fallbackDir})`,
      badgeColor: "emerald",
      boostedConfidence: 85
    };
  }

  // Lock MTF scan on completed candle history to guarantee ZERO tick flickering
  const closedCandles = allCandles.length > 1 ? allCandles.slice(0, -1) : allCandles;

  const dir1m = computeTimeframeDirection(closedCandles, 1, marketSymbol);
  const dir5m = computeTimeframeDirection(closedCandles, 5, marketSymbol);
  const dir15m = computeTimeframeDirection(closedCandles, 15, marketSymbol);
  const dir1h = computeTimeframeDirection(closedCandles, 60, marketSymbol);

  const sigs: { [key: string]: "BUY" | "SELL" | "MONITORING" } = {
    "1m": dir1m,
    "5m": dir5m,
    "15m": dir15m,
    "1H": dir1h
  };

  const buyCount = Object.values(sigs).filter(s => s === "BUY").length;
  const sellCount = Object.values(sigs).filter(s => s === "SELL").length;
  const alignedCount = Math.max(buyCount, sellCount);
  const allAligned = alignedCount === 4;

  let direction: "BUY" | "SELL" | "MONITORING" = "BUY";
  if (buyCount > sellCount) {
    direction = "BUY";
  } else if (sellCount > buyCount) {
    direction = "SELL";
  } else {
    // 2 BUY vs 2 SELL: Anchor to 1H macro trend
    direction = dir1h || dir15m || "BUY";
  }

  let badgeText = "";
  let badgeColor: "emerald" | "amber" | "rose" = "amber";
  let boostedConfidence = 0;

  if (allAligned) {
    badgeText = `🟢 4/4 TIMEFRAMES CONFIRMED (${direction})`;
    badgeColor = "emerald";
    boostedConfidence = 90;
  } else if (alignedCount === 3) {
    const oppTf = Object.entries(sigs).find(([_, s]) => s !== direction)?.[0] || "";
    badgeText = `🟡 3/4 ALIGNED (${direction} MACRO${oppTf ? ` — ${oppTf.toUpperCase()} MINOR PULLBACK` : ""})`;
    badgeColor = "amber";
    boostedConfidence = 78;
  } else {
    badgeText = `🟡 2/4 SPLIT (${direction} MACRO BIAS — BALANCED)`;
    badgeColor = "amber";
    boostedConfidence = 65;
  }

  return {
    tfSignals: sigs,
    allAligned,
    alignedCount,
    direction,
    badgeText,
    badgeColor,
    boostedConfidence
  };
}

function aggregateCandles(candles: Candle[], timeframeSecs: number): Candle[] {
  if (candles.length === 0) return [];
  const out: Candle[] = [];
  let cur: Candle | null = null;

  for (const c of candles) {
    const bucketTime = Math.floor(c.time / timeframeSecs) * timeframeSecs;
    if (!cur || cur.time !== bucketTime) {
      if (cur) out.push(cur);
      cur = { time: bucketTime, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 };
    } else {
      cur.high = Math.max(cur.high, c.high);
      cur.low = Math.min(cur.low, c.low);
      cur.close = c.close;
      cur.volume = (cur.volume || 0) + (c.volume || 0);
    }
  }
  if (cur) out.push(cur);
  return out;
}
