import { describe, expect, it } from "vitest";
import { nearestIndex, niceTicks } from "./LineChart";

describe("chart helpers", () => {
  it("picks round tick values", () => {
    expect(niceTicks(0, 39.2)).toEqual([0, 10, 20, 30, 40]);
    expect(niceTicks(0.21, 1.61)).toEqual([0, 0.5, 1, 1.5, 2]);
    expect(niceTicks(12, 31)).toEqual([10, 15, 20, 25, 30, 35]);
    expect(niceTicks(0, 100, 4)).toEqual([0, 25, 50, 75, 100]);
    expect(niceTicks(5, 5)).toEqual([5]);
  });

  it("finds the nearest x", () => {
    const x = [0, 1, 2, 4, 8];
    expect(nearestIndex(x, -5)).toBe(0);
    expect(nearestIndex(x, 2.9)).toBe(2);
    expect(nearestIndex(x, 3.1)).toBe(3);
    expect(nearestIndex(x, 100)).toBe(4);
    expect(nearestIndex([7], 3)).toBe(0);
  });
});
