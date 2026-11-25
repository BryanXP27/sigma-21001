import { describe, expect, it } from "vitest";
import { isValidSchoolDate } from "./core/time.js";

describe("school date validation", () => {
  it("accepts valid ISO calendar dates", () => {
    expect(isValidSchoolDate("2024-02-29")).toBe(true);
    expect(isValidSchoolDate("2026-11-18")).toBe(true);
  });

  it("rejects impossible dates and non-date values", () => {
    expect(isValidSchoolDate("2026-02-29")).toBe(false);
    expect(isValidSchoolDate("2026-11-31")).toBe(false);
    expect(isValidSchoolDate("2026/11/18")).toBe(false);
    expect(isValidSchoolDate(null)).toBe(false);
  });
});
