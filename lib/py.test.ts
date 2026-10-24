import { describe, expect, it } from "vitest";
import { formatFixed, fsum, pyFloat, pyMean, pyRound, pySignedFloat, pySum } from "./py";

describe("Python-compatible numbers", () => {
  it("rounds on the exact value, ties to even, like round()", () => {
    expect(pyRound(2.675, 2)).toBe(2.67); // 2.675 is stored as 2.67499999…
    expect(pyRound(0.125, 2)).toBe(0.12); // an exact tie goes to even
    expect(pyRound(0.375, 2)).toBe(0.38);
    expect(pyRound(2.5)).toBe(2);
    expect(pyRound(3.5)).toBe(4);
    expect(pyRound(-2.5)).toBe(-2);
    expect(pyRound(14.04, 1)).toBe(14);
    expect(pyRound(1e22, 1)).toBe(1e22);
    expect(Object.is(pyRound(-0.04, 1), -0)).toBe(true);
  });

  it("formats with a fixed number of decimals, like format(x, '.1f')", () => {
    expect(formatFixed(18, 1)).toBe("18.0");
    expect(formatFixed(0.05, 1)).toBe("0.1"); // 0.05 is stored as 0.05000000000000000277
    expect(formatFixed(0.25, 1)).toBe("0.2");
    expect(formatFixed(1859.5, 0)).toBe("1860");
    expect(formatFixed(-0.04, 1)).toBe("-0.0");
    expect(formatFixed(5e-324, 2)).toBe("0.00");
    expect(formatFixed(Number.NaN, 1)).toBe("nan");
    expect(formatFixed(-Infinity, 1)).toBe("-inf");
  });

  it("prints floats like repr()", () => {
    const cases: [number, string][] = [
      [14, "14.0"],
      [0.1, "0.1"],
      [9.6, "9.6"],
      [-5, "-5.0"],
      [0, "0.0"],
      [-0, "-0.0"],
      [123456.789, "123456.789"],
      [1e-5, "1e-05"],
      [0.0001, "0.0001"],
      [1.5e16, "1.5e+16"],
      [1e16, "1e+16"],
      [1234567890123456, "1234567890123456.0"],
      [Infinity, "inf"],
      [Number.NaN, "nan"],
    ];
    for (const [x, text] of cases) expect(pyFloat(x), String(x)).toBe(text);
    expect(pySignedFloat(12.3)).toBe("+12.3");
    expect(pySignedFloat(-33.6)).toBe("-33.6");
    expect(pySignedFloat(0)).toBe("+0.0");
  });

  it("sums like sum() and math.fsum", () => {
    const values = [0.1, 0.2, 0.3, 1e16, 1, -1e16];
    expect(pySum([0.1, 0.2, 0.3])).toBe(0.6); // a plain loop gives 0.6000000000000001
    expect(fsum(values)).toBe(1.6);
    expect(fsum([])).toBe(0);
    expect(pyMean([1, 2, 4])).toBeCloseTo(7 / 3);
    expect(() => pyMean([])).toThrow(RangeError);
  });
});
