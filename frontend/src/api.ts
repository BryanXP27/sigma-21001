import type {
  AuthUser,
  AttendanceEvent,
  AttendanceRecord,
  AttendanceStatus,
  CalendarDay,
  Fut,
  Guardian,
  LoginResponse,
  Personnel,
  Section,
  Student,
  SystemConfig,
  Alert,
  AuditLog,
  AcademicTerm,
  ReportArchive,
  StaffLog,
  Credential,
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function getToken(): string | null {
  if (typeof localStorage === "undefined") return null;
  return localStorage.getItem("sigma_token");
}

async function request<T>(
  path: string,
  init?: RequestInit,
  requireAuth = false
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...init?.headers,
  } as Record<string, string>;

  if (requireAuth) {
    const token = getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    if (requireAuth) {
      clearToken();
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("sigma-auth-expired"));
      }
    }
    throw new ApiError("Sesión expirada. Inicia sesión nuevamente.", 401);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message =
      typeof data === "object" &&
      data !== null &&
      "error" in data &&
      typeof (data as any).error === "string"
        ? (data as any).error
        : `La API respondió con estado ${response.status}.`;
    throw new ApiError(message, response.status);
  }

  return data as T;
}

function studentFromApi(row: any): Student {
  return {
    id: row.id ?? row.siagie_code,
    givenNames: row.givenNames ?? row.given_names ?? "",
    familyNames: row.familyNames ?? row.family_names ?? "",
    name:
      row.name ??
      [row.givenNames ?? row.given_names, row.familyNames ?? row.family_names]
        .filter(Boolean)
        .join(" "),
    doc: row.doc,
    sex: row.sex,
    birth: row.birth,
    active: Boolean(row.active),
    qr: Number(row.qr ?? 0),
    sectionId: row.sectionId ?? row.section_id ?? "",
    enrollmentStartsOn:
      row.enrollmentStartsOn ?? row.enrollment_starts_on ?? undefined,
    enrollmentEndsOn:
      row.enrollmentEndsOn ?? row.enrollment_ends_on ?? row.endsOn ?? row.ends_on ?? undefined,
  };
}

function sectionFromApi(row: any): Section {
  return {
    id: row.id,
    level: row.level,
    grade: Number(row.grade),
    label: row.label,
    shift: row.shift,
    tutor: row.tutor,
    displayName: row.displayName ?? `${row.grade}° ${row.label}`,
  };
}

function guardianFromApi(row: any): Guardian {
  return {
    id: row.id,
    studentId: row.studentId ?? row.student_id ?? "",
    studentName: row.studentName ?? row.student_name ?? "",
    name: row.name,
    doc: row.doc,
    phone: row.phone,
    relation: row.relation,
    email: row.email,
  };
}

function alertFromApi(row: any): Alert {
  return {
    id: row.id,
    studentId: row.studentId ?? row.student_id ?? "",
    studentName: row.studentName ?? row.student_name ?? "",
    alertDate: row.alertDate ?? row.alert_date ?? "",
    kind: row.kind,
    status: row.status,
    count: Number(row.count ?? 1),
    createdAt: row.createdAt ?? row.created_at ?? "",
  };
}

function futFromApi(row: any): Fut {
  return {
    id: row.id,
    studentId: row.studentId ?? row.student_id ?? "",
    studentName: row.studentName ?? row.student_name ?? "",
    futDate: row.futDate ?? row.fut_date ?? "",
    ref: row.ref,
    reason: row.reason,
    status: row.status,
    createdAt: row.createdAt ?? row.created_at ?? "",
  };
}

function calendarFromApi(row: any): CalendarDay {
  return {
    schoolDate: row.schoolDate ?? row.school_date ?? "",
    lective: Boolean(row.lective),
    reason: row.reason,
  };
}

function auditFromApi(row: any): AuditLog {
  return {
    id: row.id,
    at: row.at,
    byUser: row.byUser ?? row.by_user ?? "",
    event: row.event,
  };
}

function parseJson(value: any): any {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function archiveFromApi(row: any): ReportArchive {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    fromDate: row.fromDate ?? row.from_date ?? "",
    toDate: row.toDate ?? row.to_date ?? "",
    generatedBy: row.generatedBy ?? row.generated_by ?? "",
    role: row.role,
    sectionId: row.sectionId ?? row.section_id,
    headers: parseJson(row.headers),
    rows: parseJson(row.rows),
    createdAt: row.createdAt ?? row.created_at ?? "",
  };
}

export const api = {
  // Auth
  login: (username: string, password: string) =>
    request<LoginResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  familyRequestCode: (qr: string, dni: string) =>
    request<{ challengeId: string; previewCode?: string }>("/api/auth/family/request-code", {
      method: "POST",
      body: JSON.stringify({ qr, dni }),
    }),
  familyVerifyCode: (challengeId: string, code: string) =>
    request<LoginResponse>("/api/auth/family/verify-code", {
      method: "POST",
      body: JSON.stringify({ challengeId, code }),
    }),
  requestPasswordReset: (username: string, phone: string) =>
    request<{ challengeId: string; message: string; previewCode?: string }>(
      "/api/auth/password-reset/request",
      { method: "POST", body: JSON.stringify({ username, phone }) }
    ),
  resetPassword: (challengeId: string, code: string, newPassword: string) =>
    request<{ message: string }>("/api/auth/password-reset/verify", {
      method: "POST",
      body: JSON.stringify({ challengeId, code, newPassword }),
    }),
  logout: () => request("/api/auth/logout", { method: "POST" }, true),
  me: () => request<{ user: AuthUser }>("/api/auth/me", undefined, true),

  // Sections
  sections: async () =>
    (await request<any[]>("/api/sections", undefined, true)).map(sectionFromApi),
  section: async (id: string): Promise<Section> =>
    sectionFromApi(
      await request<any>(`/api/sections/${encodeURIComponent(id)}`, undefined, true)
    ),

  // Students
  students: async (
    sectionId?: string,
    date?: string,
    status: "active" | "inactive" | "all" = "active"
  ): Promise<Student[]> => {
    const params = new URLSearchParams({ status });
    if (sectionId) params.set("sectionId", sectionId);
    if (date) params.set("date", date);
    const rows = await request<any[]>(
      `/api/students?${params.toString()}`,
      undefined,
      true
    );
    return rows.map(studentFromApi);
  },
  student: async (siagieCode: string): Promise<Student> =>
    studentFromApi(
      await request<any>(
        `/api/students/${encodeURIComponent(siagieCode)}`,
        undefined,
        true
      )
    ),
  importStudents: (rows: Array<Record<string, unknown>>) =>
    request<any>("/api/students/import", {
      method: "POST",
      body: JSON.stringify({ rows }),
    }, true),
  updateSections: (sections: Array<{ id: string; shift: string; tutor: string | null }>) =>
    request<{ message: string }>("/api/sections", {
      method: "PUT",
      body: JSON.stringify({ sections }),
    }, true),
  createStudent: (body: Record<string, unknown>) =>
    request<any>("/api/students", {
      method: "POST",
      body: JSON.stringify(body),
    }, true),
  backup: () =>
    request<Record<string, unknown>>("/api/config/backup", undefined, true),
  updateStudent: (code: string, body: Record<string, unknown>) =>
    request<any>(`/api/students/${encodeURIComponent(code)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }, true),
  deleteStudent: (code: string) =>
    request<any>(`/api/students/${encodeURIComponent(code)}`, { method: "DELETE" }, true),
  createGuardian: (body: Record<string, unknown>) =>
    request<any>("/api/guardians", {
      method: "POST",
      body: JSON.stringify(body),
    }, true),
  updateGuardian: (id: string, body: Record<string, unknown>) =>
    request<any>(`/api/guardians/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }, true),
  createPersonnel: (body: Record<string, unknown>) =>
    request<any>("/api/personnel", {
      method: "POST",
      body: JSON.stringify(body),
    }, true),
  updatePersonnel: (id: string, body: Record<string, unknown>) =>
    request<any>(`/api/personnel/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify(body),
    }, true),
  markStaff: (body: Record<string, unknown>) =>
    request<any>("/api/personnel/mark", {
      method: "POST",
      body: JSON.stringify(body),
    }, true),

  // Attendance
  attendance: (sectionId: string, date: string) =>
    request<{
      session: { id: string; status: string } | null;
      records: Array<Omit<AttendanceRecord, "syncStatus" | "syncMessage">>;
    }>(
      `/api/attendance?sectionId=${encodeURIComponent(sectionId)}&date=${date}`,
      undefined,
      true
    ),
  mark: (event: AttendanceEvent) =>
    request<AttendanceRecord>(
      "/api/attendance",
      { method: "POST", body: JSON.stringify(event) },
      true
    ),
  sync: (events: AttendanceEvent[]) =>
    request<{
      results: Array<{
        clientEventId: string;
        outcome: "saved" | "conflict" | "rejected";
        message?: string;
        attendance?: Omit<AttendanceRecord, "syncStatus" | "syncMessage">;
      }>;
    }>("/api/attendance/sync", {
      method: "POST",
      body: JSON.stringify({ events }),
    }, true),
  close: (sectionId: string, date: string) =>
    request<{ sessionId: string; absencesCreated: number; alertsCreated: number }>(
      `/api/attendance/sessions/${encodeURIComponent(sectionId)}/close`,
      { method: "POST", body: JSON.stringify({ date }) },
      true
    ),
  reopen: (sectionId: string, date: string) =>
    request<{ sessionId: string; status: "open" }>(
      `/api/attendance/sessions/${encodeURIComponent(sectionId)}/reopen`,
      { method: "POST", body: JSON.stringify({ date }) },
      true
    ),
  correct: (id: string, status: AttendanceStatus, reason: string) =>
    request<AttendanceRecord>(
      `/api/attendance/${encodeURIComponent(id)}/correct`,
      { method: "PATCH", body: JSON.stringify({ status, reason }) },
      true
    ),

  // Personnel
  personnel: () => request<Personnel[]>("/api/personnel", undefined, true),
  staffLogs: (date: string) =>
    request<StaffLog[]>(
      `/api/personnel/logs?date=${encodeURIComponent(date)}`,
      undefined,
      true
    ),
  personnelById: (id: string) =>
    request<Personnel>(
      `/api/personnel/${encodeURIComponent(id)}`,
      undefined,
      true
    ),

  // Guardians
  guardians: async (): Promise<Guardian[]> =>
    (await request<any[]>("/api/guardians", undefined, true)).map(guardianFromApi),

  // Alerts
  alerts: async (): Promise<Alert[]> =>
    (await request<any[]>("/api/alerts", undefined, true)).map(alertFromApi),
  alert: async (id: string): Promise<Alert> =>
    alertFromApi(await request<any>(`/api/alerts/${encodeURIComponent(id)}`, undefined, true)),
  updateAlertStatus: (id: string, status: string) =>
    request<any>(`/api/alerts/${encodeURIComponent(id)}/status`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }, true),
  simulateAlertNotification: (id: string) =>
    request<{
      status: "simulated";
      sent: false;
      recipientCount: number;
      message: string;
    }>(`/api/alerts/${encodeURIComponent(id)}/notify`, {
      method: "POST",
    }, true),

  // FUTs
  futs: async (): Promise<Fut[]> =>
    (await request<any[]>("/api/futs", undefined, true)).map(futFromApi),
  fut: async (id: string): Promise<Fut> =>
    futFromApi(await request<any>(`/api/futs/${encodeURIComponent(id)}`, undefined, true)),
  createFut: (body: Record<string, unknown>) =>
    request<any>("/api/futs", {
      method: "POST",
      body: JSON.stringify(body),
    }, true),
  resolveFut: (id: string, result: "Aprobada" | "Rechazada") =>
    request<any>(`/api/futs/${encodeURIComponent(id)}/resolve`, {
      method: "PATCH",
      body: JSON.stringify({ result }),
    }, true),

  // Calendar
  calendar: async (year?: string, month?: string): Promise<CalendarDay[]> =>
    (await request<any[]>(
      `/api/calendar?${year ? `year=${year}&` : ""}${month ? `month=${month}` : ""}`,
      undefined,
      true
    )).map(calendarFromApi),
  calendarDay: async (
    date: string,
    body: { lective: boolean; reason?: string }
  ): Promise<CalendarDay> =>
    calendarFromApi(
      await request<any>(
        `/api/calendar/${encodeURIComponent(date)}`,
        { method: "PUT", body: JSON.stringify(body) },
        true
      )
    ),
  terms: async (): Promise<AcademicTerm[]> =>
    (await request<any[]>("/api/calendar/terms", undefined, true)).map((term) => ({
      id: term.id,
      startsOn: String(term.starts_on ?? term.startsOn ?? "").slice(0, 10),
      endsOn: String(term.ends_on ?? term.endsOn ?? "").slice(0, 10),
      academicYearId: term.academic_year_id ?? term.academicYearId ?? 0,
    })),
  updateTerms: (yearId: number, terms: Array<{ startsOn: string; endsOn: string }>) =>
    request<any>("/api/calendar/terms", {
      method: "PUT",
      body: JSON.stringify({
        yearId,
        terms: terms.map((term) => ({ starts_on: term.startsOn, ends_on: term.endsOn })),
      }),
    }, true),

  // Users
  users: async (): Promise<AuthUser[]> => {
    const data = await request<any[]>("/api/users", undefined, true);
    return data.map((u) => ({
      id: u.id,
      username: u.username,
      fullName: u.full_name ?? u.fullName ?? "",
      role: u.role,
      active: u.active,
      phone: u.phone ?? null,
    }));
  },
  createUser: async (body: {
    username: string;
    password: string;
    full_name: string;
    role: string;
    active?: boolean;
    phone?: string;
  }): Promise<AuthUser> => {
    const u = await request<any>("/api/users", {
      method: "POST",
      body: JSON.stringify(body),
    }, true);
    return {
      id: u.id,
      username: u.username,
      fullName: u.full_name ?? u.fullName ?? "",
      role: u.role,
      active: u.active,
      phone: u.phone ?? null,
    };
  },
  updateUser: async (id: string, body: {
    full_name?: string;
    role?: string;
    active?: boolean;
    password?: string;
    phone?: string | null;
  }): Promise<AuthUser> => {
    const u = await request<any>(
      `/api/users/${encodeURIComponent(id)}`,
      { method: "PUT", body: JSON.stringify(body) },
      true
    );
    return {
      id: u.id,
      username: u.username,
      fullName: u.full_name ?? u.fullName ?? "",
      role: u.role,
      active: u.active,
      phone: u.phone ?? null,
    };
  },
  deleteUser: (id: string) =>
    request(
      `/api/users/${encodeURIComponent(id)}`,
      { method: "DELETE" },
      true
    ),

  // Audit
  audit: async (query = ""): Promise<{
    logs: AuditLog[];
    total: number;
    limit: number;
    offset: number;
  }> => {
    const data = await request<any>(
      `/api/audit${query ? `?${query}` : ""}`,
      undefined,
      true
    );
    return {
      ...data,
      logs: (data.logs ?? []).map(auditFromApi),
    };
  },

  // Config
  config: () => request<SystemConfig[]>("/api/config", undefined, true),
  saveConfig: (values: Record<string, string>) =>
    request<any>("/api/config", {
      method: "POST",
      body: JSON.stringify(values),
    }, true),
  resetConfig: () => request<any>("/api/config/reset", { method: "POST" }, true),
  resetDemo: () =>
    request<{ message: string }>("/api/config/reset-demo", { method: "POST" }, true),

  // Reports
  reports: (queryString: string) =>
    request<{
      headers: string[];
      columns: string[];
      rows: any[];
      mode: string;
      from: string;
      to: string;
    }>(`/api/reports?${queryString}`, undefined, true),
  archiveReport: (body: {
    title: string;
    kind: "students" | "staff";
    from_date: string;
    to_date: string;
    headers: any;
    rows: any;
  }) =>
    request<any>(
      "/api/reports/archive",
      { method: "POST", body: JSON.stringify(body) },
      true
    ),
  archives: async (): Promise<ReportArchive[]> =>
    (await request<any[]>("/api/reports/archives", undefined, true)).map(archiveFromApi),

  // Credentials
  credentials: async (type: "students" | "staff"): Promise<Credential[]> =>
    (await request<any[]>(
      `/api/credentials?type=${type}`,
      undefined,
      true
    )).map((row) => ({
      id: row.id,
      name: row.name,
      qr: Number(row.qr ?? 0),
      section: row.section,
      role: row.role,
      active: Boolean(row.active),
      familyQrToken: row.family_qr_token ?? row.familyQrToken,
    })),
  reissueQr: (type: "students" | "staff", id: string) =>
    request<any>(
      `/api/credentials/${type}/${encodeURIComponent(id)}/reissue`,
      { method: "POST" },
      true
    ),

  // Family portal
  familyOverview: () =>
    request<{
      guardianName: string | null;
      students: Array<{
        studentId: string;
        name: string;
        sectionId: string | null;
        sectionLabel: string | null;
        guardianName: string;
        relation: string | null;
        counts: {
          present: number;
          late: number;
          absent: number;
          excused: number;
          permit: number;
        };
        records: Array<{
          id: string;
          date: string;
          status: string;
          source: string;
          recordedAt: string;
        }>;
      }>;
    }>("/api/family/overview", undefined, true),

  // Health
  health: () => request<{ status: string }>("/api/health"),
};

export function setToken(token: string): void {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem("sigma_token", token);
  }
}

export function cacheAuthUser(user: AuthUser): void {
  if (typeof localStorage === "undefined") return;
  const cached: AuthUser = {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    active: user.active,
  };
  localStorage.setItem("sigma_user", JSON.stringify(cached));
}

export function getCachedAuthUser(): AuthUser | null {
  if (typeof localStorage === "undefined") return null;
  const raw = localStorage.getItem("sigma_user");
  if (!raw) return null;
  try {
    const user = JSON.parse(raw) as Partial<AuthUser>;
    const roles = [
      "direccion", "subdireccion", "pip", "oficina",
      "docente", "auxiliar", "apoderado",
    ];
    if (
      typeof user.id !== "string" ||
      typeof user.username !== "string" ||
      typeof user.fullName !== "string" ||
      typeof user.role !== "string" ||
      !roles.includes(user.role) ||
      typeof user.active !== "boolean"
    ) {
      return null;
    }
    return user as AuthUser;
  } catch {
    return null;
  }
}

export function clearToken(): void {
  if (typeof localStorage !== "undefined") {
    localStorage.removeItem("sigma_token");
    localStorage.removeItem("sigma_user");
  }
}

export function isAuthenticated(): boolean {
  if (typeof localStorage === "undefined") return false;
  return !!localStorage.getItem("sigma_token");
}
