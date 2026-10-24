/**
 * Number handling that matches Python, so the port gives the same numbers and texts as the Python
 * version (checked against fixtures/golden/). Python rounds on the exact value of a double and
 * breaks ties to even; it prints floats as `14.0`; its `sum()` compensates rounding errors (3.12+);
 * `statistics.mean` is exact.
 */

/** A finite double as an exact decimal: `digits / 10^scale`. */
function exactDecimal(x: number): { digits: bigint; scale: number } {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, Math.abs(x));
  const hi = view.getUint32(0);
  const lo = view.getUint32(4);
  const biased = (hi >>> 20) & 0x7ff;
  let mantissa = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
  let exponent: number;
  if (biased === 0) {
    exponent = -1074; // subnormal
  } else {
    mantissa |= 1n << 52n;
    exponent = biased - 1075;
  }
  if (exponent >= 0) return { digits: mantissa << BigInt(exponent), scale: 0 };
  return { digits: mantissa * 5n ** BigInt(-exponent), scale: -exponent };
}

/** Python's `format(x, f".{n}f")`: correctly rounded, ties to even. */
export function formatFixed(x: number, n: number): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf";
  const { digits, scale } = exactDecimal(x);
  let kept: bigint;
  if (scale <= n) {
    kept = digits * 10n ** BigInt(n - scale);
  } else {
    const unit = 10n ** BigInt(scale - n);
    kept = digits / unit;
    const rest = digits % unit;
    const half = unit / 2n;
    if (rest > half || (rest === half && kept % 2n === 1n)) kept += 1n;
  }
  const text = kept.toString().padStart(n + 1, "0");
  const sign = x < 0 || Object.is(x, -0) ? "-" : "";
  return n === 0 ? sign + text : `${sign}${text.slice(0, -n)}.${text.slice(-n)}`;
}

/** Python's `round(x, n)`. */
export function pyRound(x: number, n = 0): number {
  return Number(formatFixed(x, n));
}

/** Python's `repr()` of a float: `14.0`, `0.1`, `1e-05`, `1.5e+16`. */
export function pyFloat(x: number): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  // Shortest digits that round-trip (the same digits Python picks), then Python's layout.
  const [mantissa, exp] = Math.abs(x).toExponential().split("e");
  const digits = mantissa.replace(".", "");
  const e = Number(exp);
  const sign = x < 0 ? "-" : "";
  if (e < -4 || e >= 16) {
    const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    return `${sign}${m}e${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
  }
  if (e < 0) return `${sign}0.${"0".repeat(-e - 1)}${digits}`;
  const int = digits.slice(0, e + 1).padEnd(e + 1, "0");
  const frac = digits.slice(e + 1) || "0";
  return `${sign}${int}.${frac}`;
}

/** Python's `format(x, "+")` of a float: `+12.3`, `-5.0`. */
export function pySignedFloat(x: number): string {
  const text = pyFloat(x);
  return text.startsWith("-") ? text : `+${text}`;
}

/** Python's `sum()` of floats (3.12+): Neumaier's compensated summation. */
export function pySum(values: Iterable<number>): number {
  let total = 0;
  let compensation = 0;
  for (const v of values) {
    const t = total + v;
    compensation += Math.abs(total) >= Math.abs(v) ? total - t + v : v - t + total;
    total = t;
  }
  return total + compensation;
}

/**
 * Exact sum of doubles, correctly rounded (Shewchuk's algorithm, as Python's `math.fsum`). Unlike
 * CPython it doesn't recover from an intermediate overflow, which dive values never reach.
 */
export function fsum(values: Iterable<number>): number {
  const partials: number[] = [];
  for (let x of values) {
    let i = 0;
    for (let y of partials) {
      if (Math.abs(x) < Math.abs(y)) [x, y] = [y, x];
      const hi = x + y;
      const lo = y - (hi - x);
      if (lo !== 0) partials[i++] = lo;
      x = hi;
    }
    partials.length = i;
    partials.push(x);
  }
  // Add the partials from the largest, with the half-way correction of CPython's math.fsum.
  let n = partials.length;
  if (n === 0) return 0;
  let hi = partials[--n];
  let lo = 0;
  while (n > 0) {
    const x = hi;
    const y = partials[--n];
    hi = x + y;
    lo = y - (hi - x);
    if (lo !== 0) break;
  }
  if (n > 0 && ((lo < 0 && partials[n - 1] < 0) || (lo > 0 && partials[n - 1] > 0))) {
    const y = lo * 2;
    const x = hi + y;
    if (y === x - hi) hi = x;
  }
  return hi;
}

/** `statistics.mean` of floats: the exact sum divided by the count. */
export function pyMean(values: number[]): number {
  if (values.length === 0) throw new RangeError("mean requires at least one value");
  return fsum(values) / values.length;
}

/** Python's max() of numbers: the largest, without spreading a long array into arguments. */
export function pyMax(values: number[]): number {
  if (values.length === 0) throw new RangeError("max() of an empty sequence");
  let best = values[0];
  for (const v of values) if (v > best) best = v;
  return best;
}

/** Python's min() of numbers. */
export function pyMin(values: number[]): number {
  if (values.length === 0) throw new RangeError("min() of an empty sequence");
  let best = values[0];
  for (const v of values) if (v < best) best = v;
  return best;
}
