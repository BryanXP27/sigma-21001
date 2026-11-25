import { describe, expect, it } from "vitest";
import {
  canAccess,
  resolveSectionForRole,
  STAFF_ROLES,
} from "./core/auth.js";

describe("role access scoping", () => {
  it("does not grant institutional routes to guardians", () => {
    expect(canAccess("apoderado", [...STAFF_ROLES])).toBe(false);
  });

  it("limits teaching staff to their assigned section", () => {
    expect(resolveSectionForRole("docente", "4B")).toBe("3A");
    expect(resolveSectionForRole("auxiliar", undefined)).toBe("3A");
    expect(resolveSectionForRole("direccion", "4B")).toBe("4B");
  });
});
