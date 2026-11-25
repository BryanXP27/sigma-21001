import { describe, expect, it } from "vitest";
import { attendanceEventSchema } from "./modules/student-attendance/index.js";

const validEvent = {
  clientEventId: "e7815c3c-a760-4d01-aad8-d3c7f02dd6a7",
  sectionId: "3A",
  studentId: "00000000012001",
  date: "2026-11-18",
  status: "present",
  source: "manual",
  recordedAt: "2026-11-18T18:35:00.000Z",
};

describe("attendance event validation", () => {
  it("accepts a valid attendance event", () => {
    expect(attendanceEventSchema.safeParse(validEvent).success).toBe(true);
  });

  it("rejects unknown students and unsupported states", () => {
    expect(
      attendanceEventSchema.safeParse({
        ...validEvent,
        studentId: "not-a-siagie-code",
      }).success,
    ).toBe(false);
    expect(
      attendanceEventSchema.safeParse({
        ...validEvent,
        status: "none",
      }).success,
    ).toBe(false);
  });

  it("rejects impossible calendar dates", () => {
    expect(
      attendanceEventSchema.safeParse({
        ...validEvent,
        date: "2026-02-31",
      }).success,
    ).toBe(false);
  });
});
