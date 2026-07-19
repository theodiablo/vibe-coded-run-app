import { describe, it, expect } from "vitest";
import { usageLeft, usageFraction, usageTone } from "./coachUsage";

describe("usageLeft", () => {
  it("counts remaining requests", () => {
    expect(usageLeft({ used: 2, limit: 5 })).toBe(3);
    expect(usageLeft({ used: 0, limit: 5 })).toBe(5);
  });
  it("never goes negative (counter can climb past the cap on rejected sends)", () => {
    expect(usageLeft({ used: 6, limit: 5 })).toBe(0);
  });
});

describe("usageFraction", () => {
  it("is the clamped used/limit ratio", () => {
    expect(usageFraction({ used: 3, limit: 5 })).toBeCloseTo(0.6);
    expect(usageFraction({ used: 7, limit: 5 })).toBe(1);
  });
  it("treats a zero/invalid limit as fully spent", () => {
    expect(usageFraction({ used: 0, limit: 0 })).toBe(1);
  });
});

describe("usageTone (fraction thresholds — override-friendly)", () => {
  it("escalates over the default 5/day budget", () => {
    expect(usageTone({ used: 0, limit: 5 })).toBe("normal");
    expect(usageTone({ used: 2, limit: 5 })).toBe("normal");
    expect(usageTone({ used: 3, limit: 5 })).toBe("warn");
    expect(usageTone({ used: 4, limit: 5 })).toBe("critical");
    expect(usageTone({ used: 5, limit: 5 })).toBe("exhausted");
    expect(usageTone({ used: 6, limit: 5 })).toBe("exhausted");
  });
  it("scales with a per-user override, not fixed counts", () => {
    // A premium limit of 20 stays "normal" at counts that would exhaust a 5-cap.
    expect(usageTone({ used: 6, limit: 20 })).toBe("normal");
    expect(usageTone({ used: 12, limit: 20 })).toBe("warn");
    expect(usageTone({ used: 16, limit: 20 })).toBe("critical");
    expect(usageTone({ used: 20, limit: 20 })).toBe("exhausted");
  });
});
