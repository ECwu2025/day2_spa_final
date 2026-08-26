import { describe, it, expect } from 'vitest';
import {
  sma, ema, computeMACD, computeRSI, rsiFromAverages, detectCross, detectAllCrosses,
  computeVolatility, computeBeta, backtestCrossSignals, backtestRsiSignals
} from './indicators.js';

describe('sma', () => {
  it('is null before the window fills, then a plain moving average', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
});

describe('ema', () => {
  it('seeds with the SMA of the first window, then applies the EMA formula', () => {
    // seed = avg(1,2,3) = 2 at index 2; k = 2/(3+1) = 0.5
    // index 3: 4*0.5 + 2*0.5 = 3; index 4: 5*0.5 + 3*0.5 = 4
    expect(ema([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('tolerates leading nulls, starting the seed window from the first real value', () => {
    expect(ema([null, null, 1, 2, 3], 3)).toEqual([null, null, null, null, 2]);
  });
});

describe('rsiFromAverages', () => {
  it('is neutral (50) on a flat run with no gains or losses', () => {
    expect(rsiFromAverages(0, 0)).toBe(50);
  });

  it('is 100 when there are gains but zero losses', () => {
    expect(rsiFromAverages(1.5, 0)).toBe(100);
  });

  it('matches the standard RS formula otherwise', () => {
    expect(rsiFromAverages(0.5, 0.5)).toBe(50);
    expect(rsiFromAverages(1.25, 0.25)).toBeCloseTo(83.33, 1);
  });
});

describe('computeRSI', () => {
  it('matches a hand-worked example (period 2)', () => {
    // closes: 10, 11, 10, 12 -> diffs: +1, -1, +2
    // seed (first 2 diffs): avgGain=0.5, avgLoss=0.5 -> RSI=50
    // next diff +2: avgGain=(0.5*1+2)/2=1.25, avgLoss=(0.5*1+0)/2=0.25 -> RSI=83.33
    const rsi = computeRSI([10, 11, 10, 12], 2);
    expect(rsi[0]).toBeNull();
    expect(rsi[1]).toBeNull();
    expect(rsi[2]).toBeCloseTo(50, 5);
    expect(rsi[3]).toBeCloseTo(83.33, 1);
  });

  it('stays neutral on a flat price series', () => {
    const flat = new Array(20).fill(100);
    const rsi = computeRSI(flat, 14);
    expect(rsi[14]).toBe(50);
    expect(rsi[19]).toBe(50);
  });
});

describe('computeMACD', () => {
  it('is flat (all zero) on a constant price series once warmed up', () => {
    const closes = new Array(40).fill(100);
    const { macdLine, signalLine, histogram } = computeMACD(closes);
    expect(macdLine[35]).toBeCloseTo(0, 8);
    expect(signalLine[35]).toBeCloseTo(0, 8);
    expect(histogram[35]).toBeCloseTo(0, 8);
  });
});

describe('detectCross / detectAllCrosses', () => {
  // fast crosses above slow at index 2 (golden), back below at index 4 (death)
  const fastSma = [1, 1, 3, 3, 1];
  const slowSma = [2, 2, 2, 2, 2];
  const dates = ['d0', 'd1', 'd2', 'd3', 'd4'];

  it('detectCross reports only the most recent crossover', () => {
    const { currentlyBullish, lastCross } = detectCross(fastSma, slowSma, dates);
    expect(currentlyBullish).toBe(false);
    expect(lastCross).toEqual({ type: 'death', date: 'd4' });
  });

  it('detectAllCrosses reports every crossover in order', () => {
    const crosses = detectAllCrosses(fastSma, slowSma, dates);
    expect(crosses).toEqual([
      { type: 'golden', date: 'd2', index: 2 },
      { type: 'death', date: 'd4', index: 4 }
    ]);
  });
});

describe('computeVolatility', () => {
  it('is zero for a series with no day-to-day change', () => {
    expect(computeVolatility(new Array(30).fill(100))).toBeCloseTo(0, 8);
  });

  it('is positive and finite for a series that actually moves', () => {
    const closes = [100, 102, 99, 103, 98, 105, 101, 104, 97, 106];
    const vol = computeVolatility(closes);
    expect(vol).toBeGreaterThan(0);
    expect(Number.isFinite(vol)).toBe(true);
  });
});

describe('computeBeta', () => {
  it('is ~1 when the stock moves exactly like the benchmark', () => {
    const bench = [100, 101, 102, 101, 103, 104, 103, 105];
    expect(computeBeta(bench, bench)).toBeCloseTo(1, 5);
  });

  it('is ~2 when the stock moves at exactly double the benchmark\'s daily log return', () => {
    const bench = [100, 101, 102, 101, 103, 104, 103, 105];
    // Build a stock series whose log returns are exactly 2x the benchmark's.
    const stock = [100];
    for (let i = 1; i < bench.length; i++) {
      const benchReturn = Math.log(bench[i] / bench[i - 1]);
      stock.push(stock[i - 1] * Math.exp(benchReturn * 2));
    }
    expect(computeBeta(stock, bench)).toBeCloseTo(2, 5);
  });
});

describe('backtestCrossSignals', () => {
  it('measures the actual forward return after a golden cross', () => {
    // Golden cross at index 2; price then rises steadily for the next 3 days.
    const closes = [10, 10, 10, 11, 12, 13];
    const fastSma = [1, 1, 3, 3, 3, 3];
    const slowSma = [2, 2, 2, 2, 2, 2];
    const dates = closes.map((_, i) => `d${i}`);

    const result = backtestCrossSignals(closes, fastSma, slowSma, dates, 3);
    expect(result.golden.count).toBe(1);
    // (13 - 10) / 10 = 0.3
    expect(result.golden.avgReturn).toBeCloseTo(0.3, 5);
    expect(result.golden.winRate).toBe(100);
  });
});

describe('backtestRsiSignals', () => {
  it('measures the forward return after RSI enters oversold territory', () => {
    const rsi = [50, 40, 25, 45, 60];
    const closes = [100, 95, 90, 96, 102];
    const result = backtestRsiSignals(closes, rsi, 2);
    // Oversold entry at index 2 (25, crossing down from 40): forward 2-day return = (102-90)/90
    expect(result.oversold.count).toBe(1);
    expect(result.oversold.avgReturn).toBeCloseTo((102 - 90) / 90, 5);
  });
});
