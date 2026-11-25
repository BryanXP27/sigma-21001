export type AttendanceStatus =
  | "present"
  | "late"
  | "absent"
  | "excused"
  | "permit";

export type DemoProfile =
  | "direccion"
  | "subdireccion"
  | "pip"
  | "oficina"
  | "docente"
  | "auxiliar"
  | "apoderado";

export type UserRole =
  | "direccion"
  | "subdireccion"
  | "pip"
  | "oficina"
  | "docente"
  | "auxiliar"
  | "apoderado";

export interface Section {
  id: string;
  level: string;
  grade: number;
  label: string;
  shift: "Mañana" | "Tarde";
  tutor?: string;
  displayName: string;
}

export interface Student {
  id: string;
  givenNames: string;
  familyNames: string;
  name: string;
  doc?: string;
  sex?: string;
  birth?: string;
  active: boolean;
  qr: number;
  sectionId: string;
  enrollmentStartsOn?: string;
  enrollmentEndsOn?: string;
}

export interface Enrollment {
  id: string;
  studentId: string;
  sectionId: string;
  startsOn: string;
  endsOn?: string;
  status: "active" | "withdrawn" | "transferred";
}

export interface AttendanceRecord {
  id?: string;
  sessionId?: string;
  studentId: string;
  sectionId: string;
  date: string;
  status: AttendanceStatus;
  source: "manual" | "qr" | "closure";
  recordedAt: string;
  clientEventId: string;
  demoProfile: DemoProfile;
  syncStatus: "synced" | "pending" | "conflict";
  syncMessage?: string;
  reason?: string;
  recordedBy?: string;
  correctedBy?: string;
  correctedAt?: string;
}

export interface AttendanceEvent {
  clientEventId: string;
  sectionId: string;
  studentId: string;
  date: string;
  status: AttendanceStatus;
  source: "manual" | "qr";
  recordedAt: string;
  demoProfile: DemoProfile;
}

export interface SessionInfo {
  id: string;
  status: "open" | "closed";
}

export interface Personnel {
  id: string;
  name: string;
  role: string;
  shift: "Mañana" | "Tarde";
  contact?: string;
  doc?: string;
  active: boolean;
  qr: number;
}

export interface StaffLog {
  id: string;
  personnelId: string;
  logDate: string;
  inTime?: string | null;
  outTime?: string | null;
  source: string;
}

export interface Credential {
  id: string;
  name: string;
  qr: number;
  section?: string;
  role?: string;
  active: boolean;
  familyQrToken?: string;
}

export interface Guardian {
  id: string;
  studentId: string;
  studentName?: string;
  name: string;
  doc?: string;
  phone?: string;
  relation?: string;
  email?: string;
}

export interface Alert {
  id: string;
  studentId: string;
  studentName?: string;
  alertDate: string;
  kind: "absence" | "threshold";
  status: "Pendiente" | "Preparado" | "Resuelta";
  count: number;
  createdAt: string;
}

export interface Fut {
  id: string;
  studentId: string;
  studentName?: string;
  futDate: string;
  ref: string;
  reason: string;
  status: "Pendiente" | "Aprobada" | "Rechazada";
  createdAt: string;
}

export interface CalendarDay {
  schoolDate: string;
  lective: boolean;
  reason?: string;
}

export interface AcademicTerm {
  id: number;
  startsOn: string;
  endsOn: string;
  academicYearId: number;
}

export interface SystemConfig {
  key: string;
  value: string;
  updatedAt: string;
}

export interface AuditLog {
  id: string;
  at: string;
  byUser: string;
  event: string;
}

export interface ReportArchive {
  id: string;
  title: string;
  kind: "students" | "staff";
  fromDate: string;
  toDate: string;
  generatedBy: string;
  role: string;
  sectionId?: string;
  headers: any;
  rows: any;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  active: boolean;
  phone?: string | null;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}
