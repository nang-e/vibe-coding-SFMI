import { describe, it, expect } from 'vitest';
import { computeThemeReactionStats } from '../lib/stats';

describe('computeThemeReactionStats', () => {
  it('averages the change_pct N days after past same-sentiment tags', () => {
    const result = computeThemeReactionStats([
      { changePctAfter: -3 },
      { changePctAfter: -5 },
      { changePctAfter: -1 },
    ]);
    expect(result.sampleSize).toBe(3);
    expect(result.avgChangePct).toBeCloseTo(-3, 5);
    expect(result.minChangePct).toBe(-5);
    expect(result.maxChangePct).toBe(-1);
  });

  it('flags low confidence when sample size is small', () => {
    const result = computeThemeReactionStats([{ changePctAfter: -2 }]);
    expect(result.sampleSize).toBe(1);
    expect(result.lowSample).toBe(true);
  });

  it('handles an empty input without dividing by zero', () => {
    const result = computeThemeReactionStats([]);
    expect(result.sampleSize).toBe(0);
    expect(result.avgChangePct).toBeNull();
    expect(result.lowSample).toBe(true);
  });
});
