// Pure, DOM-free math: technical indicators, backtesting, and risk metrics.
// Kept separate from main.js so it can be unit-tested directly (see
// indicators.test.js) — none of this touches the network or the page.

export function sma(values, window) {
  const out = new Array(values.length).fill(null);
  for (let i = window - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - window + 1; j <= i; j++) sum += values[j];
    out[i] = sum / window;
  }
  return out;
}

// Tolerates leading nulls in `series` so it can chain onto another
// indicator's output (e.g. the MACD signal line is an EMA of the MACD line,
// which itself starts with nulls until the slow EMA has enough data).
export function ema(series, window) {
  const out = new Array(series.length).fill(null);
  const start = series.findIndex((v) => v != null);
  if (start === -1) return out;

  const seedEnd = start + window - 1;
  if (seedEnd >= series.length) return out;

  let seed = 0;
  for (let i = start; i <= seedEnd; i++) seed += series[i];
  out[seedEnd] = seed / window;

  const k = 2 / (window + 1);
  for (let i = seedEnd + 1; i < series.length; i++) {
    out[i] = series[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

export function computeMACD(closes) {
  const fastEma = ema(closes, 12);
  const slowEma = ema(closes, 26);
  const macdLine = closes.map((_, i) => (fastEma[i] != null && slowEma[i] != null ? fastEma[i] - slowEma[i] : null));
  const signalLine = ema(macdLine, 9);
  const histogram = macdLine.map((v, i) => (v != null && signalLine[i] != null ? v - signalLine[i] : null));
  return { macdLine, signalLine, histogram };
}

export function computeRSI(closes, period) {
  const out = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;

  let gainSum = 0;
  let lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff;
    else lossSum -= diff;
  }
  let avgGain = gainSum / period;
  let avgLoss = lossSum / period;
  out[period] = rsiFromAverages(avgGain, avgLoss);

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    out[i] = rsiFromAverages(avgGain, avgLoss);
  }
  return out;
}

export function rsiFromAverages(avgGain, avgLoss) {
  // A flat run (no gains, no losses) is neutral, not "maximally overbought" —
  // the plain avgLoss===0 check alone gets this wrong, since 0/0 also hits it.
  if (avgGain === 0 && avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

export function detectCross(fastSma, slowSma, dates) {
  let lastSign = null;
  let lastCross = null;
  for (let i = 0; i < fastSma.length; i++) {
    if (fastSma[i] == null || slowSma[i] == null) continue;
    const sign = fastSma[i] >= slowSma[i] ? 1 : -1;
    if (lastSign !== null && sign !== lastSign) {
      lastCross = { type: sign === 1 ? 'golden' : 'death', date: dates[i] };
    }
    lastSign = sign;
  }
  return { currentlyBullish: lastSign === 1, lastCross };
}

// Every crossover in the window (not just the most recent), for backtesting.
export function detectAllCrosses(fastSma, slowSma, dates) {
  const crosses = [];
  let lastSign = null;
  for (let i = 0; i < fastSma.length; i++) {
    if (fastSma[i] == null || slowSma[i] == null) continue;
    const sign = fastSma[i] >= slowSma[i] ? 1 : -1;
    if (lastSign !== null && sign !== lastSign) {
      crosses.push({ type: sign === 1 ? 'golden' : 'death', date: dates[i], index: i });
    }
    lastSign = sign;
  }
  return crosses;
}

export function computeIndicators(priceData, fastWindow, slowWindow, rsiPeriod) {
  const closes = priceData.map((d) => d.close);
  const dates = priceData.map((d) => d.date);
  const fastSma = sma(closes, fastWindow);
  const slowSma = sma(closes, slowWindow);
  const { macdLine, signalLine, histogram } = computeMACD(closes);
  const rsi = computeRSI(closes, rsiPeriod);
  const cross = detectCross(fastSma, slowSma, dates);
  return { fastWindow, slowWindow, rsiPeriod, fastSma, slowSma, macdLine, signalLine, histogram, rsi, cross };
}

export function mergeIndicators(priceData, indicators) {
  return priceData.map((d, i) => ({
    ...d,
    fastSma: indicators.fastSma[i],
    slowSma: indicators.slowSma[i],
    macd: indicators.macdLine[i],
    signal: indicators.signalLine[i],
    histogram: indicators.histogram[i],
    rsi: indicators.rsi[i]
  }));
}

export function lastNonNull(arr) {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i] != null) return arr[i];
  return null;
}

export function fmt(v) {
  return v == null ? 'n/a' : v.toFixed(2);
}

export function rsiState(v) {
  if (v == null) return 'n/a';
  if (v >= 70) return 'overbought';
  if (v <= 30) return 'oversold';
  return 'neutral';
}

// --- Risk metrics -----------------------------------------------------

export function dailyReturns(closes) {
  const out = [];
  for (let i = 1; i < closes.length; i++) out.push(Math.log(closes[i] / closes[i - 1]));
  return out;
}

function mean(arr) {
  return arr.reduce((sum, v) => sum + v, 0) / arr.length;
}

// Annualized historical volatility (%) from daily log returns.
export function computeVolatility(closes) {
  const returns = dailyReturns(closes);
  if (returns.length < 2) return null;
  const m = mean(returns);
  const variance = mean(returns.map((r) => (r - m) ** 2));
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

// Beta of the stock's daily returns against a benchmark's (e.g. SPY), aligned
// by the shorter of the two series (both are assumed oldest-to-newest).
export function computeBeta(stockCloses, benchmarkCloses) {
  const n = Math.min(stockCloses.length, benchmarkCloses.length);
  if (n < 3) return null;
  const stockReturns = dailyReturns(stockCloses.slice(-n));
  const benchReturns = dailyReturns(benchmarkCloses.slice(-n));
  const len = Math.min(stockReturns.length, benchReturns.length);
  if (len < 2) return null;

  const s = stockReturns.slice(-len);
  const b = benchReturns.slice(-len);
  const meanS = mean(s);
  const meanB = mean(b);
  let covariance = 0;
  let benchVariance = 0;
  for (let i = 0; i < len; i++) {
    covariance += (s[i] - meanS) * (b[i] - meanB);
    benchVariance += (b[i] - meanB) ** 2;
  }
  if (benchVariance === 0) return null;
  return covariance / benchVariance;
}

// --- Backtesting --------------------------------------------------------

function forwardReturn(closes, index, horizon) {
  const target = index + horizon;
  if (target >= closes.length) return null;
  return (closes[target] - closes[index]) / closes[index];
}

function summarize(returns, winIsPositive) {
  if (!returns.length) return { count: 0, avgReturn: null, winRate: null };
  const avgReturn = mean(returns);
  const wins = returns.filter((r) => (winIsPositive ? r > 0 : r < 0)).length;
  return { count: returns.length, avgReturn, winRate: (wins / returns.length) * 100 };
}

// Forward `horizon`-day return after every golden/death cross in the window,
// plus a naive buy-and-hold baseline (the same horizon's average return
// starting from ANY day) so the signal can be judged against doing nothing.
export function backtestCrossSignals(closes, fastSma, slowSma, dates, horizon = 10) {
  const crosses = detectAllCrosses(fastSma, slowSma, dates);
  const goldenReturns = crosses.filter((c) => c.type === 'golden').map((c) => forwardReturn(closes, c.index, horizon)).filter((r) => r != null);
  const deathReturns = crosses.filter((c) => c.type === 'death').map((c) => forwardReturn(closes, c.index, horizon)).filter((r) => r != null);

  const baseline = [];
  for (let i = 0; i < closes.length - horizon; i++) {
    baseline.push(forwardReturn(closes, i, horizon));
  }

  return {
    horizon,
    golden: summarize(goldenReturns, true),
    death: summarize(deathReturns, false),
    baseline: summarize(baseline, true)
  };
}

// Forward `horizon`-day return after RSI enters oversold (<=30, expecting a
// bounce) or overbought (>=70, expecting a pullback).
export function backtestRsiSignals(closes, rsi, horizon = 10) {
  const oversoldReturns = [];
  const overboughtReturns = [];
  for (let i = 1; i < rsi.length; i++) {
    if (rsi[i] == null || rsi[i - 1] == null) continue;
    if (rsi[i] <= 30 && rsi[i - 1] > 30) {
      const r = forwardReturn(closes, i, horizon);
      if (r != null) oversoldReturns.push(r);
    }
    if (rsi[i] >= 70 && rsi[i - 1] < 70) {
      const r = forwardReturn(closes, i, horizon);
      if (r != null) overboughtReturns.push(r);
    }
  }
  return {
    horizon,
    oversold: summarize(oversoldReturns, true),
    overbought: summarize(overboughtReturns, false)
  };
}
