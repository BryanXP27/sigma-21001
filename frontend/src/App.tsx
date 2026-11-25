import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ApiError,
  cacheAuthUser,
  clearToken,
  getCachedAuthUser,
  isAuthenticated,
  setToken,
} from "./api";
import type {
  Alert,
  AttendanceEvent,
  AttendanceRecord,
  AttendanceStatus,
  AuthUser,
  CalendarDay,
  DemoProfile,
  Section,
  Student,
} from "./types";
import {
  cacheRoster,
  deleteAttendance,
  readAllAttendance,
  readAttendance,
  readSections,
  readStudents,
  readSession,
  saveAttendance,
  saveAttendanceBatch,
  saveSession,
} from "./offlineDb";
import { Students } from "./features/students/Students";
import { Personnel } from "./features/personnel/Personnel";
import { Guardians } from "./features/guardians/Guardians";
import { Alerts } from "./features/follow-up/alerts/Alerts";
import { Futs } from "./features/follow-up/futs/Futs";
import { Reports } from "./features/reports/Reports";
import { Calendar } from "./features/calendar/Calendar";
import { Credentials } from "./features/credentials/Credentials";
import { Users } from "./features/users/Users";
import { Audit } from "./features/audit/Audit";
import { Settings } from "./features/settings/Settings";
import { Familia } from "./features/family/Familia";
import { expectedQr, parseQrCode, peruClock, proposedStatus } from "./shared/attendance";
import { peruTodayIso } from "./shared/time";
import {
  Btn,
  Card,
  Chart,
  FeedRow,
  Icon,
  Metric,
  Modal,
  Notice,
  PageHead,
  PersonCell,
  Pill,
  Summary,
  Table,
  Toolbar,
} from "./shared/ui";

const statusLabels: Record<AttendanceStatus, string> = {
  present: "Asistió",
  late: "Tardanza",
  absent: "Falta injustificada",
  excused: "Falta justificada",
  permit: "Permiso",
};

const statusTone: Record<AttendanceStatus, "green" | "orange" | "red" | "blue" | ""> = {
  present: "green",
  late: "orange",
  absent: "red",
  excused: "blue",
  permit: "blue",
};

const roleLabels: Record<string, string> = {
  direccion: "Dirección",
  subdireccion: "Subdirección",
  pip: "Docente PIP",
  oficina: "Oficina",
  docente: "Docente de aula",
  auxiliar: "Auxiliar",
  apoderado: "Apoderado",
};

const navIcons: Record<string, string> = {
  dashboard: "layout-dashboard",
  asistencia: "scan-line",
  estudiantes: "graduation-cap",
  personal: "contact-round",
  apoderados: "users",
  alertas: "bell-ring",
  justificaciones: "clipboard-check",
  reportes: "chart-no-axes-combined",
  calendario: "calendar-days",
  carnes: "id-card",
  usuarios: "shield-check",
  bitacora: "history",
  configuracion: "settings",
  familia: "graduation-cap",
};

const navLabels: Record<string, string> = {
  dashboard: "Dashboard",
  asistencia: "Asistencia",
  estudiantes: "Estudiantes",
  personal: "Personal",
  apoderados: "Apoderados",
  alertas: "Alertas y citaciones",
  justificaciones: "Justificaciones FUT",
  reportes: "Reportes",
  calendario: "Calendario escolar",
  carnes: "Carnés QR",
  usuarios: "Usuarios y roles",
  bitacora: "Bitácora",
  configuracion: "Configuración",
  familia: "Mi familia",
};

function shiftDate(date: string, days: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function peruTimestamp(date: string, clock: string) {
  const normalized = clock.length === 5 ? `${clock}:00` : clock;
  return new Date(`${date}T${normalized}-05:00`).toISOString();
}

function attendanceKey(sectionId: string, date: string) {
  return `${sectionId}|${date}`;
}

function formatLongDate(date: string) {
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

function formatShortDate(date: string) {
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: "UTC",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));
}

function timeFromIso(value: string) {
  return new Date(value).toLocaleTimeString("es-PE", {
    timeZone: "America/Lima",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function sourceLabel(source?: AttendanceRecord["source"]) {
  if (source === "closure") return "Cierre de jornada";
  if (source === "qr") return "QR";
  if (source === "manual") return "Manual";
  return "—";
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [date, setDate] = useState(peruTodayIso);
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionId, setSectionId] = useState("");
  const [students, setStudents] = useState<Student[]>([]);
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [session, setSession] = useState<{ id: string; status: "open" | "closed" } | null>(null);
  const [connection, setConnection] = useState<"loading" | "online" | "offline">("loading");
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(() => {
    const hash = window.location.hash.replace("#", "");
    return hash && hash !== "login" ? hash : "login";
  });
  const [attendanceMode, setAttendanceMode] = useState<"list" | "qr">("list");
  const [qrValueInput, setQrValueInput] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [familyCameraActive, setFamilyCameraActive] = useState(false);
  const [familyCameraError, setFamilyCameraError] = useState("");
  const [config, setConfig] = useState<Record<string, string>>({});
  const [calendarDays, setCalendarDays] = useState<CalendarDay[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [trend, setTrend] = useState<Array<{ date: string; present: number; late: number }>>([]);
  const [correction, setCorrection] = useState<{
    recordId: string;
    studentName: string;
    status: AttendanceStatus;
    reason: string;
  } | null>(null);
  const [markDialog, setMarkDialog] = useState<{
    studentId: string;
    status: AttendanceStatus;
    clock: string;
  } | null>(null);
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [conflictDiscard, setConflictDiscard] = useState<AttendanceRecord | null>(null);
  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [familyMode, setFamilyMode] = useState(false);
  const [familyQrInput, setFamilyQrInput] = useState("");
  const [familyDni, setFamilyDni] = useState("");
  const [familyChallenge, setFamilyChallenge] = useState("");
  const [familyOtp, setFamilyOtp] = useState("");
  const [familyPreviewCode, setFamilyPreviewCode] = useState("");
  const [resetUsername, setResetUsername] = useState("");
  const [resetPhone, setResetPhone] = useState("");
  const [resetChallenge, setResetChallenge] = useState("");
  const [resetOtp, setResetOtp] = useState("");
  const [resetNewPassword, setResetNewPassword] = useState("");
  const [resetPreviewCode, setResetPreviewCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberLogin, setRememberLogin] = useState(false);
  const [navSearch, setNavSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalQuery, setGlobalQuery] = useState("");
  const [studentQuery, setStudentQuery] = useState("");
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [demoOffline, setDemoOffline] = useState(false);
  const [reopenConfirm, setReopenConfirm] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const cameraStream = useRef<MediaStream | null>(null);
  const cameraFrame = useRef<number | null>(null);

  const section = sections.find((item) => item.id === sectionId);
  const visibleStudents = useMemo(
    () => students.filter((student) => student.sectionId === sectionId),
    [students, sectionId]
  );
  const recordByStudent = useMemo(
    () => new Map(records.map((record) => [record.studentId, record])),
    [records]
  );
  const conflictCount = records.filter(
    (record) => record.syncStatus === "conflict"
  ).length;
  const isClosed = session?.status === "closed";
  const attendanceCounts = useMemo(
    () =>
      visibleStudents.reduce(
        (counts, student) => {
          const record = recordByStudent.get(student.id);
          if (!record) counts.unmarked += 1;
          else counts[record.status] += 1;
          return counts;
        },
        {
          unmarked: 0,
          present: 0,
          late: 0,
          absent: 0,
          excused: 0,
          permit: 0,
        }
      ),
    [visibleStudents, recordByStudent]
  );
  const pendingAlerts = alerts.filter((alert) => alert.status === "Pendiente");
  const isApoderado = user?.role === "apoderado";
  const isAuthority = ["direccion", "subdireccion", "pip"].includes(user?.role ?? "");
  const canManage = isAuthority || user?.role === "oficina";
  const canAttend = isAuthority || user?.role === "docente" || user?.role === "auxiliar";
  const calendarEntry = calendarDays.find((item) => item.schoolDate === date);
  const isLective = calendarEntry ? calendarEntry.lective : ![0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());
  const isLoginView = view === "login" || !user;
  const roleAccess: Record<string, string[]> = {
    dashboard: ["direccion", "subdireccion", "pip", "oficina", "docente", "auxiliar"],
    asistencia: ["direccion", "subdireccion", "pip", "oficina", "docente", "auxiliar"],
    estudiantes: ["direccion", "subdireccion", "pip", "oficina", "docente", "auxiliar"],
    personal: ["direccion", "subdireccion", "pip", "oficina"],
    apoderados: ["direccion", "subdireccion", "oficina"],
    alertas: ["direccion", "subdireccion", "pip", "oficina", "docente", "auxiliar"],
    justificaciones: ["direccion", "subdireccion", "pip", "oficina", "docente", "auxiliar"],
    reportes: ["direccion", "subdireccion", "pip", "oficina", "docente", "auxiliar"],
    calendario: ["direccion", "subdireccion", "pip", "oficina", "docente", "auxiliar"],
    carnes: ["direccion", "subdireccion", "pip", "oficina"],
    usuarios: ["direccion", "subdireccion", "pip", "oficina"],
    bitacora: ["direccion", "subdireccion", "oficina"],
    configuracion: ["direccion", "subdireccion"],
    familia: ["apoderado"],
  };

  useEffect(() => {
    const remembered = localStorage.getItem("sigma_remember_user");
    if (remembered) {
      setLoginUser(remembered);
      setRememberLogin(true);
    }
  }, []);

  useEffect(() => {
    const handleExpiredSession = () => {
      setUser(null);
      setView("login");
      setError("La sesión expiró o fue revocada. Inicia sesión nuevamente.");
    };
    window.addEventListener("sigma-auth-expired", handleExpiredSession);
    return () => window.removeEventListener("sigma-auth-expired", handleExpiredSession);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        if (isAuthenticated()) {
          const data = await api.me();
          setUser(data.user);
          cacheAuthUser(data.user);
          const hashView = window.location.hash.replace("#", "");
          const fallback = data.user.role === "apoderado" ? "familia" : "dashboard";
          const requested = hashView && hashView !== "login" ? hashView : fallback;
          setView(roleAccess[requested]?.includes(data.user.role) ? requested : fallback);
        }
      } catch (authError) {
        if (authError instanceof ApiError && authError.status === 401) {
          clearToken();
          setUser(null);
        } else {
          const cachedUser = getCachedAuthUser();
          if (cachedUser && isAuthenticated()) {
            setUser(cachedUser);
            setConnection("offline");
            setError("Sin conexión: se conservó la sesión local. Algunas funciones requieren internet.");
          } else {
            setUser(null);
          }
        }
      } finally {
        setAuthLoading(false);
      }
    })();
  }, []);

  const loadWorkspace = useCallback(async () => {
    if (!sectionId) return;
    setLoading(true);
    setError("");

    try {
      let nextStudents: Student[];
      let nextSession: { id: string; status: "open" | "closed" } | null = null;
      let serverRecords: AttendanceRecord[] = [];

      try {
        const [studentResult, attendanceResult] = await Promise.all([
          api.students(sectionId, date),
          api.attendance(sectionId, date),
        ]);
        nextStudents = studentResult;
        nextSession = attendanceResult.session
          ? {
              id: attendanceResult.session.id,
              status: attendanceResult.session.status as "open" | "closed",
            }
          : null;
        serverRecords = attendanceResult.records.map((record) =>
          Object.assign({}, record, {
            sectionId,
            date,
            demoProfile: (user?.role as DemoProfile) ?? "docente",
            syncStatus: "synced" as const,
          })
        );
        await cacheRoster([], nextStudents);
        await saveAttendanceBatch(serverRecords);
        await saveSession(attendanceKey(sectionId, date), nextSession);
        setConnection("online");
      } catch {
        nextStudents = await readStudents(sectionId);
        nextSession = await readSession(attendanceKey(sectionId, date));
        if (nextStudents.length === 0) {
          throw new Error(
            "No hay una nómina guardada para esta sección. Conéctate una vez para prepararla para el uso sin internet."
          );
        }
        setConnection("offline");
      }

      const localRecords = await readAttendance(date);
      const allLocalRecords = await readAllAttendance();
      setPendingCount(
        allLocalRecords.filter((record) => record.syncStatus === "pending").length
      );
      const merged = new Map<string, AttendanceRecord>();
      serverRecords.forEach((record) => merged.set(record.studentId, record));
      localRecords
        .filter((record) => record.sectionId === sectionId)
        .forEach((record) => {
          const serverRecord = merged.get(record.studentId);
          if (
            !serverRecord ||
            record.syncStatus === "pending" ||
            record.syncStatus === "conflict"
          ) {
            merged.set(record.studentId, record);
          }
        });

      setStudents(nextStudents);
      setSession(nextSession);
      setRecords([...merged.values()]);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "No se pudo cargar la asistencia."
      );
    } finally {
      setLoading(false);
    }
  }, [date, sectionId, user?.role]);

  const syncPending = useCallback(async () => {
    if (!navigator.onLine || demoOffline || busy) return;
    setBusy(true);
    try {
      const all = await readAllAttendance();
      const pending = all.filter((record) => record.syncStatus === "pending");
      if (pending.length === 0) {
        setConnection("online");
        return;
      }

      const next: AttendanceRecord[] = [];
      for (let offset = 0; offset < pending.length; offset += 200) {
        const batch = pending.slice(offset, offset + 200);
        const response = await api.sync(
          batch.map((record) => ({
            clientEventId: record.clientEventId,
            sectionId: record.sectionId,
            studentId: record.studentId,
            date: record.date,
            status: record.status,
            source: record.source === "closure" ? "manual" : record.source,
            recordedAt: record.recordedAt,
            demoProfile: record.demoProfile,
          }))
        );
        const outcomes = new Map(
          response.results.map((result) => [result.clientEventId, result])
        );
        const updated = batch.map((record) => {
          const result = outcomes.get(record.clientEventId);
          if (result?.outcome === "saved" && result.attendance) {
            return Object.assign({}, result.attendance, {
              sectionId: record.sectionId,
              date: record.date,
              demoProfile: record.demoProfile,
              syncStatus: "synced" as const,
            }) as AttendanceRecord;
          }
          return {
            ...record,
            syncStatus: "conflict" as const,
            syncMessage: result?.message ?? "No se pudo confirmar este registro.",
          };
        });
        await saveAttendanceBatch(updated);
        next.push(...updated);
      }

      const remaining = await readAllAttendance();
      setPendingCount(
        remaining.filter((record) => record.syncStatus === "pending").length
      );
      setConnection("online");
      await loadWorkspace();
      setMessage(`Se sincronizaron ${next.length} registro(s).`);
    } catch (syncError) {
      setConnection("offline");
      setError(
        syncError instanceof Error
          ? `No se completó la sincronización: ${syncError.message}`
          : "No se completó la sincronización."
      );
    } finally {
      setBusy(false);
    }
  }, [busy, demoOffline, loadWorkspace]);

  useEffect(() => {
    const handleOnline = () => {
      if (demoOffline) return;
      setConnection("online");
      void syncPending();
    };
    const handleOffline = () => setConnection("offline");
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [syncPending]);

  useEffect(() => {
    if (!user || user.role === "apoderado") return;
    (async () => {
      try {
        const canReadConfig = ["direccion", "subdireccion"].includes(user.role);
        const [fetched, systemConfig, calendar] = await Promise.all([
          api.sections(),
          canReadConfig ? api.config().catch(() => []) : Promise.resolve([]),
          api.calendar(date.slice(0, 4), date.slice(5, 7)).catch(() => []),
        ]);
        setSections(fetched);
        setCalendarDays(calendar);
        setConfig(
          systemConfig.reduce<Record<string, string>>((values, item) => {
            values[item.key] = item.value;
            return values;
          }, {})
        );
        await cacheRoster(fetched, []);
        setSectionId((current) => {
          if (current && fetched.some((item) => item.id === current)) {
            return current;
          }
          return fetched.some((item) => item.id === "3A")
            ? "3A"
            : fetched[0]?.id ?? "";
        });
        setConnection("online");
        setAlerts(await api.alerts().catch(() => []));
      } catch {
        try {
          const cached = await readSections();
          setSections(cached);
          setSectionId((current) => current || cached[0]?.id || "");
          setConnection("offline");
          if (cached.length === 0) {
            setError(
              "No hay secciones guardadas. Conéctate una vez para descargar los datos de demostración."
            );
          }
        } catch {
          setConnection("offline");
          setError("No se pudieron leer los datos guardados en este equipo.");
        }
      }
    })();
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (user?.role !== "apoderado") void loadWorkspace();
  }, [loadWorkspace, user?.role]);

  useEffect(() => {
    if (!user || user.role === "apoderado" || !sectionId || connection !== "online") return;
    let cancelled = false;
    const dates = Array.from({ length: 5 }, (_, index) => shiftDate(date, index - 4));
    void (async () => {
      const result = await Promise.all(
        dates.map((item) => api.attendance(sectionId, item).catch(() => null))
      );
      if (cancelled) return;
      setTrend(
        dates.map((item, index) => {
          const dayRecords = result[index]?.records ?? [];
          return {
            date: item,
            present: dayRecords.filter(
              (record) => record.status === "present" || record.status === "excused"
            ).length,
            late: dayRecords.filter((record) => record.status === "late").length,
          };
        })
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.role, sectionId, date, connection]);

  useEffect(() => {
    if (message || error) {
      const timer = window.setTimeout(() => {
        setMessage("");
        setError("");
      }, 5200);
      return () => window.clearTimeout(timer);
    }
  }, [message, error]);

  useEffect(() => {
    if (!view || view === "login") return;
    const hash = `#${view}`;
    if (window.location.hash !== hash) {
      window.history.replaceState(null, "", hash);
    }
  }, [view]);

  useEffect(() => {
    if (!user || isLoginView) return;
    if (!roleAccess[view]?.includes(user.role ?? "")) {
      setView(isApoderado ? "familia" : "dashboard");
    }
  }, [user, isApoderado, isLoginView, roleAccess, view]);

  async function markStudent(
    student: Student,
    status: AttendanceStatus,
    source: "manual" | "qr" = "manual",
    clock?: string
  ) {
    if (isClosed || !sectionId) return;
    if (recordByStudent.has(student.id)) {
      setError("Este estudiante ya tiene un registro en esta jornada.");
      return;
    }

    const event: AttendanceEvent = {
      clientEventId: crypto.randomUUID(),
      sectionId,
      studentId: student.id,
      date,
      status,
      source,
      recordedAt: clock ? peruTimestamp(date, clock) : new Date().toISOString(),
      demoProfile: (user?.role as DemoProfile) ?? "docente",
    };
    const localRecord: AttendanceRecord = {
      ...event,
      syncStatus: "pending",
    };
    setError("");
    setMessage("");

    if (!navigator.onLine || connection === "offline") {
      await saveAttendance(localRecord);
      setRecords((current) => [...current, localRecord]);
      setPendingCount((count) => count + 1);
      setMessage(`${student.name}: guardado en la cola local.`);
      setConnection("offline");
      return;
    }

    try {
      const saved = await api.mark(event);
      const record = Object.assign({}, saved, {
        sectionId,
        date,
        demoProfile: (user?.role as DemoProfile) ?? "docente",
        syncStatus: "synced" as const,
      });
      await saveAttendance(record);
      setRecords((current) => [...current, record]);
      setMessage(`${student.name}: ${statusLabels[status]} registrado.`);
      setSession((current) => current ?? { id: saved.sessionId ?? "", status: "open" });
    } catch (markError: any) {
      if (markError.status < 500) {
        setError(markError.message ?? "No se pudo registrar la asistencia.");
        return;
      }
      await saveAttendance(localRecord);
      setRecords((current) => [...current, localRecord]);
      setPendingCount((count) => count + 1);
      setConnection("offline");
      setMessage(`${student.name}: guardado localmente; se sincronizará al reconectar.`);
    }
  }

  async function commitClose() {
    if (!sectionId || isClosed || pendingCount > 0 || conflictCount > 0) return;
    if (!navigator.onLine || connection !== "online") {
      setError("El cierre requiere conexión y una cola local sincronizada.");
      return;
    }
    setCloseConfirm(false);
    setBusy(true);
    setError("");
    try {
      const result = await api.close(sectionId, date);
      setMessage(
        `Jornada cerrada. Se registraron ${result.absencesCreated} falta(s) por cierre y ${result.alertsCreated ?? 0} alerta(s).`
      );
      await loadWorkspace();
      setAlerts(await api.alerts().catch(() => []));
    } catch (closeError) {
      setError(
        closeError instanceof Error
          ? closeError.message
          : "No se pudo cerrar la jornada."
      );
    } finally {
      setBusy(false);
    }
  }

  async function commitConflictDiscard() {
    if (!conflictDiscard) return;
    await deleteAttendance(conflictDiscard.clientEventId);
    setConflictDiscard(null);
    await loadWorkspace();
    setMessage(
      "Se quitó el registro local en conflicto; se conserva el estado del servidor."
    );
  }

  function stopCamera() {
    if (cameraFrame.current !== null) {
      cancelAnimationFrame(cameraFrame.current);
      cameraFrame.current = null;
    }
    cameraStream.current?.getTracks().forEach((track) => track.stop());
    cameraStream.current = null;
    setCameraActive(false);
  }

  function stopFamilyCamera() {
    if (cameraFrame.current !== null) {
      cancelAnimationFrame(cameraFrame.current);
      cameraFrame.current = null;
    }
    cameraStream.current?.getTracks().forEach((track) => track.stop());
    cameraStream.current = null;
    setFamilyCameraActive(false);
  }

  async function startFamilyCamera() {
    if (familyCameraActive) {
      stopFamilyCamera();
      return;
    }
    const BarcodeDetectorClass = (window as any).BarcodeDetector;
    if (!BarcodeDetectorClass || !navigator.mediaDevices?.getUserMedia) {
      setFamilyCameraError(
        "Este navegador no ofrece lectura QR con cámara. Usa el código o la lista."
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      cameraStream.current = stream;
      setFamilyCameraActive(true);
      setFamilyCameraError("");
      const video = document.getElementById(
        "sigma-family-camera"
      ) as HTMLVideoElement | null;
      if (!video) {
        stopFamilyCamera();
        return;
      }
      video.srcObject = stream;
      await video.play();
      const detector = new BarcodeDetectorClass({ formats: ["qr_code"] });
      const scan = async () => {
        if (!cameraStream.current || !video.isConnected) {
          stopFamilyCamera();
          return;
        }
        try {
          const hits = await detector.detect(video);
          if (hits[0]?.rawValue) {
            setFamilyQrInput(String(hits[0].rawValue));
            stopFamilyCamera();
            return;
          }
        } catch {
          // Un cuadro ilegible no interrumpe la lectura.
        }
        cameraFrame.current = requestAnimationFrame(scan);
      };
      void scan();
    } catch {
      stopFamilyCamera();
      setFamilyCameraError("No se pudo abrir la cámara. Usa el código o la lista.");
    }
  }

  async function acceptFamilyQr(value: string) {
    setFamilyQrInput(value.trim());
    stopFamilyCamera();
  }

  async function acceptQr(value: string) {
    const parsed = parseQrCode(value);
    const student = parsed
      ? visibleStudents.find((item) => item.id === parsed.studentId)
      : undefined;
    if (!parsed || !student || !expectedQr(value, student.id, student.qr)) {
      setError("Carné inválido o código de estudiante desconocido.");
      return;
    }
    if (recordByStudent.has(student.id)) {
      setError("Este estudiante ya tiene un registro en esta jornada.");
      return;
    }
    const clock = peruClock();
    const status = proposedStatus(
      clock,
      section,
      config.cutAM ?? "09:00:00",
      config.cutPM ?? "14:00:00"
    );
    setError("");
    setQrValueInput("");
    await markStudent(student, status, "qr", clock);
    setMessage(
      `${student.name}: ${statusLabels[status]} registrado por QR (${clock}).`
    );
  }

  async function startCamera() {
    if (cameraActive) {
      stopCamera();
      return;
    }
    const BarcodeDetectorClass = (window as any).BarcodeDetector;
    if (!BarcodeDetectorClass || !navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        "Este navegador no ofrece lectura QR con cámara. Usa el código o la lista."
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      cameraStream.current = stream;
      setCameraActive(true);
      setCameraError("");
      const video = document.getElementById("sigma-camera") as HTMLVideoElement | null;
      if (!video) {
        stopCamera();
        return;
      }
      video.srcObject = stream;
      await video.play();
      const detector = new BarcodeDetectorClass({ formats: ["qr_code"] });
      const scan = async () => {
        if (!cameraStream.current || !video.isConnected) {
          stopCamera();
          return;
        }
        try {
          const hits = await detector.detect(video);
          if (hits[0]?.rawValue) {
            await acceptQr(String(hits[0].rawValue));
            stopCamera();
            return;
          }
        } catch {
          // Un cuadro ilegible no interrumpe la lectura.
        }
        cameraFrame.current = requestAnimationFrame(scan);
      };
      void scan();
    } catch {
      stopCamera();
      setCameraError("No se pudo abrir la cámara. Usa el código o la lista.");
    }
  }

  function fillTestQr() {
    const student = visibleStudents.find((item) => !recordByStudent.has(item.id));
    if (!student) {
      setMessage("Todos los estudiantes del aula ya tienen registro.");
      return;
    }
    setQrValueInput(`SIGMA:E:${student.id}:${student.qr}`);
    setMessage("Código de prueba cargado. Pulsa Registrar.");
  }

  async function reopenSession() {
    if (!sectionId || !isAuthority) return;
    setBusy(true);
    setError("");
    try {
      await api.reopen(sectionId, date);
      setMessage("Jornada reabierta. Puedes revisar y corregir registros.");
      await loadWorkspace();
    } catch (reopenError) {
      setError(
        reopenError instanceof Error
          ? reopenError.message
          : "No se pudo reabrir la jornada."
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitCorrection() {
    if (!correction) return;
    if (correction.reason.trim().length < 3) {
      setError("Indica el motivo o la referencia del FUT.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await api.correct(
        correction.recordId,
        correction.status,
        correction.reason.trim()
      );
      setMessage(
        `Corrección guardada para ${correction.studentName}: ${statusLabels[correction.status]}.`
      );
      setCorrection(null);
      await loadWorkspace();
    } catch (correctError) {
      setError(
        correctError instanceof Error
          ? correctError.message
          : "No se pudo guardar la corrección."
      );
    } finally {
      setBusy(false);
    }
  }

  async function submitMark() {
    if (!markDialog) return;
    const student = students.find((item) => item.id === markDialog.studentId);
    if (!student) return;
    await markStudent(student, markDialog.status, "manual", markDialog.clock);
    setMarkDialog(null);
  }

  async function handleLogin(username: string, password: string) {
    try {
      const data = await api.login(username, password);
      setToken(data.token);
      cacheAuthUser(data.user);
      setUser(data.user);
      setView(data.user.role === "apoderado" ? "familia" : "dashboard");
      if (rememberLogin) localStorage.setItem("sigma_remember_user", username);
      else localStorage.removeItem("sigma_remember_user");
      setError("");
      setLoginPass("");
    } catch (err: any) {
      setError(err?.message ?? "Error al iniciar sesión.");
    }
  }

  async function requestFamilyCode() {
    setError("");
    setMessage("");
    try {
      const result = await api.familyRequestCode(familyQrInput.trim(), familyDni.trim());
      stopFamilyCamera();
      setFamilyChallenge(result.challengeId);
      setFamilyPreviewCode(result.previewCode ?? "");
      setMessage("Código solicitado al celular registrado. El código vence en 5 minutos.");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "No se pudo solicitar el código.");
    }
  }

  async function verifyFamilyCode() {
    if (!familyChallenge) return;
    setError("");
    setMessage("");
    try {
      const result = await api.familyVerifyCode(familyChallenge, familyOtp.trim());
      setToken(result.token);
      cacheAuthUser(result.user);
      setUser(result.user);
      setView("familia");
      setFamilyMode(false);
      setFamilyChallenge("");
      setFamilyOtp("");
      setFamilyPreviewCode("");
      setFamilyQrInput("");
      setFamilyDni("");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "No se pudo verificar el código.");
    }
  }

  async function requestPasswordCode() {
    setError("");
    setMessage("");
    try {
      const result = await api.requestPasswordReset(resetUsername.trim(), resetPhone.trim());
      setResetChallenge(result.challengeId);
      setResetPreviewCode(result.previewCode ?? "");
      setMessage(result.message);
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "No se pudo solicitar la recuperación.");
    }
  }

  async function verifyPasswordCode() {
    if (!resetChallenge) return;
    setError("");
    try {
      const result = await api.resetPassword(
        resetChallenge,
        resetOtp.trim(),
        resetNewPassword
      );
      setMessage(result.message);
      setHelpOpen(false);
      setResetChallenge("");
      setResetOtp("");
      setResetNewPassword("");
      setResetPreviewCode("");
    } catch (authError) {
      setError(authError instanceof Error ? authError.message : "No se pudo restablecer la contraseña.");
    }
  }

  function handleLogout() {
    stopCamera();
    clearToken();
    setUser(null);
    setView("login");
    setSectionId("");
    setProfileOpen(false);
    setDemoOffline(false);
  }

  function goTo(next: string) {
    setView(next);
    setSidebarOpen(false);
    setProfileOpen(false);
    setGlobalSearchOpen(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function toggleDemoOffline() {
    if (demoOffline) {
      setDemoOffline(false);
      setConnection(navigator.onLine ? "online" : "offline");
      setMessage("Conexión restaurada.");
      if (navigator.onLine) void syncPending();
    } else {
      setDemoOffline(true);
      setConnection("offline");
      setMessage("Desconexión simulada. Los nuevos registros quedarán en la cola local.");
    }
    setConnectionOpen(false);
  }

  const getNavItems = () => {
    const groups: Array<{ group: string; items: string[] }> = [
      {
        group: "Operación escolar",
        items: ["dashboard", "asistencia", "estudiantes", "personal", "apoderados"],
      },
      { group: "Seguimiento", items: ["alertas", "justificaciones", "reportes"] },
      {
        group: "Administración",
        items: ["calendario", "carnes", "usuarios", "bitacora", "configuracion"],
      },
    ];
    if (isApoderado) groups.push({ group: "Mi familia", items: ["familia"] });
    const query = navSearch.trim().toLowerCase();
    return groups
      .map((group) => ({
        ...group,
        items: group.items.filter((id) => {
          if (!roleAccess[id]?.includes(user?.role ?? "")) return false;
          return !query || navLabels[id].toLowerCase().includes(query);
        }),
      }))
      .filter((group) => group.items.length > 0);
  };

  const navItems = getNavItems();
  const moduleQuery = (navSearch.trim() || globalQuery.trim()).toLowerCase();
  const studentSearch = studentQuery.trim() || globalQuery.trim();
  const moduleMatches = navItems
    .flatMap((group) => group.items.map((id) => ({ id, group: group.group })))
    .filter((item) => !moduleQuery || navLabels[item.id]?.toLowerCase().includes(moduleQuery));
  const studentMatches = students
    .filter((item) =>
      !studentSearch ||
      item.name.toLowerCase().includes(studentSearch.toLowerCase()) ||
      item.id.includes(studentSearch)
    )
    .slice(0, 8);
  const dashboardSections =
    user?.role === "docente" || user?.role === "auxiliar"
      ? sections.filter((item) => item.id === sectionId)
      : sections.slice(0, 6);

  if (authLoading) {
    return (
      <div className="login" style={{ placeItems: "center" }}>
        <div className="eyebrow">Cargando sesión…</div>
      </div>
    );
  }

  if (isLoginView) {
    return (
      <div className="login" id="app">
        <section className="login-art">
          <div className="institution">
            <img src="/insignia.png" alt="Insignia de la I.E.P. Zoilo Candela Sánchez" />
            <div>
              <strong>I.E.P. N.° 21001</strong>
              <small>Zoilo Candela Sánchez · Imperial, Cañete</small>
            </div>
          </div>

          <div className="login-copy">
            <div className="eyebrow">SIGMA 21001 · ASISTENCIA ESCOLAR</div>
            <h1>
              Asistencia escolar
              <span>en un solo lugar.</span>
            </h1>
            <p>
              Registra la asistencia por aula, revisa las inasistencias y genera reportes para la
              gestión escolar.
            </p>
            <div className="login-features">
              <span><Icon name="scan-line" size={15} /> Registro QR</span>
              <span><Icon name="bell-ring" size={15} /> Alertas oportunas</span>
              <span><Icon name="chart-no-axes-combined" size={15} /> Reportes por sección</span>
            </div>
          </div>

          <p className="fine">Prototipo interactivo · Hora de Perú</p>
        </section>

        <section className="login-panel">
          <div className="login-inner">
            <div className="eyebrow">ACCESO INSTITUCIONAL</div>
            <h2>Bienvenido a SIGMA</h2>
            <p>Ingresa con tu cuenta para acceder a la plataforma.</p>

            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleLogin(loginUser, loginPass);
              }}
            >
              <div className="form-field">
                <label htmlFor="login-user">Usuario</label>
                <input
                  id="login-user"
                  type="text"
                  autoComplete="username"
                  placeholder="Ej. direccion"
                  value={loginUser}
                  onChange={(event) => setLoginUser(event.target.value)}
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="login-pass">Contraseña</label>
                <div className="password-wrap">
                  <input
                    id="login-pass"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    placeholder="Contraseña"
                    value={loginPass}
                    onChange={(event) => setLoginPass(event.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    <Icon name={showPassword ? "eye-off" : "eye"} size={17} />
                  </button>
                </div>
              </div>
              <label className="check-row">
                <input
                  type="checkbox"
                  checked={rememberLogin}
                  onChange={(event) => setRememberLogin(event.target.checked)}
                />
                Recordar sesión
              </label>
              <button type="button" className="link-button" onClick={() => setHelpOpen(true)}>
                ¿Olvidaste tu contraseña?
              </button>
              {error && <span className="error">{error}</span>}
              <Btn type="submit" className="submit">
                Iniciar sesión <Icon name="arrow-right" size={16} />
              </Btn>
            </form>

            <div className="demo-box">
              <strong><Icon name="laptop" size={16} /> &nbsp;Explora la demo</strong>
              <p>Entra con un perfil y prueba sus funciones con datos ficticios.</p>
              <div className="row">
                {([
                  "direccion",
                  "docente",
                  "apoderado",
                ] as const).map((role) => (
                  <Btn
                    key={role}
                    type="button"
                    variant="secondary"
                    slim
                    onClick={() => void handleLogin(role, "Sigma2026")}
                  >
                    {roleLabels[role]}
                  </Btn>
                ))}
              </div>
            </div>
            <Btn
              type="button"
              variant="secondary"
              className="submit"
              onClick={() => {
                setError("");
                setFamilyChallenge("");
                stopFamilyCamera();
                setFamilyMode((current) => !current);
              }}
            >
              {familyMode ? "Volver al acceso institucional" : "Muestra familiar · Acceso con QR"}
            </Btn>
            {familyMode && (
              <form
                className="card pad stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (familyChallenge) void verifyFamilyCode();
                  else void requestFamilyCode();
                }}
              >
                <strong>Verificación familiar</strong>
                {!familyChallenge ? (
                  <>
                    <div className="form-field">
                      <label htmlFor="family-qr">QR del carné del estudiante</label>
                      <input
                        id="family-qr"
                        value={familyQrInput}
                        onChange={(event) => setFamilyQrInput(event.target.value)}
                        placeholder="Escanea o pega el contenido del QR"
                        autoComplete="off"
                        required
                      />
                    </div>
                    <div className="form-field">
                      <div className="scanning">
                        <Icon name="scan-qr-code" size={34} />
                        <div className="fine">Enfoca el carné dentro del recuadro.</div>
                      </div>
                      <video
                        id="sigma-family-camera"
                        className={`camera ${familyCameraActive ? "live" : ""}`}
                        playsInline
                        muted
                      />
                      {familyCameraError && <span className="error">{familyCameraError}</span>}
                      <div className="row">
                        <Btn
                          variant="secondary"
                          icon="camera"
                          slim
                          onClick={() => void startFamilyCamera()}
                        >
                          {familyCameraActive ? "Detener cámara" : "Activar cámara"}
                        </Btn>
                        <Btn
                          variant="ghost"
                          icon="qr-code"
                          slim
                          onClick={(event) => {
                            event.preventDefault();
                            void acceptFamilyQr(familyQrInput);
                          }}
                        >
                          Usar código pegado
                        </Btn>
                      </div>
                    </div>
                    <div className="form-field">
                      <label htmlFor="family-dni">DNI del apoderado</label>
                      <input
                        id="family-dni"
                        inputMode="numeric"
                        pattern="[0-9]{8}"
                        maxLength={8}
                        value={familyDni}
                        onChange={(event) => setFamilyDni(event.target.value.replace(/\D/g, ""))}
                        required
                      />
                    </div>
                    <Btn type="submit" className="submit">
                      Solicitar código SMS <Icon name="message-square" size={16} />
                    </Btn>
                  </>
                ) : (
                  <>
                    <p className="fine">Ingresa el código de 6 dígitos enviado al teléfono registrado. Vence en 5 minutos.</p>
                    {familyPreviewCode && (
                      <Notice tone="warn">
                        Modo de pruebas: no se envió un SMS. Código de verificación: <strong>{familyPreviewCode}</strong>
                      </Notice>
                    )}
                    <div className="form-field">
                      <label htmlFor="family-otp">Código de verificación</label>
                      <input
                        id="family-otp"
                        inputMode="numeric"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        value={familyOtp}
                        onChange={(event) => setFamilyOtp(event.target.value.replace(/\D/g, ""))}
                        required
                      />
                    </div>
                    <div className="row">
                      <Btn type="submit" className="submit">Verificar y entrar</Btn>
                      <Btn
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          setFamilyChallenge("");
                          setFamilyOtp("");
                          setFamilyPreviewCode("");
                        }}
                      >
                        Cambiar datos
                      </Btn>
                    </div>
                  </>
                )}
              </form>
            )}
            <p className="login-small">Prototipo interactivo · Hora de Perú</p>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="shell" id="app">
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <div className="side-brand">
          <img src="/insignia.png" alt="Insignia institucional" />
          <div>
            <strong>SIGMA 21001</strong>
            <small>GESTIÓN DE ASISTENCIA</small>
          </div>
        </div>

        <nav className="side-nav" aria-label="Navegación principal">
          {navItems.map((group) => (
            <div key={group.group}>
              <div className="nav-group">{group.group}</div>
              {group.items.map((id) => (
                <button
                  key={id}
                  className={`nav-link ${view === id ? "active" : ""}`}
                  onClick={() => goTo(id)}
                >
                  <Icon name={navIcons[id] ?? "info"} size={17} />
                  {navLabels[id] ?? id}
                  {id === "alertas" && pendingAlerts.length > 0 && (
                    <span className="count">{pendingAlerts.length}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="side-foot">
          <button className="nav-link" onClick={handleLogout}>
            <Icon name="log-out" size={17} /> Cerrar sesión
          </button>
        </div>
      </aside>

      <button
        className={`scrim ${sidebarOpen ? "open" : ""}`}
        aria-label="Cerrar menú"
        onClick={() => setSidebarOpen(false)}
      />

      <div>
        <header className="topbar">
          <div className="crumb">
            <button
              className="icon-btn mobile-toggle"
              onClick={() => setSidebarOpen((current) => !current)}
              aria-label="Abrir menú"
            >
              <Icon name="menu" size={17} />
            </button>
            <span className="root">SIGMA 21001</span>
            <Icon name="chevron-right" size={14} />
            <strong>{navLabels[view] ?? "SIGMA 21001"}</strong>
          </div>

          <div className="top-actions">
            <button
              className="icon-btn"
              onClick={() => {
                setGlobalQuery("");
                setGlobalSearchOpen(true);
              }}
              aria-label="Buscar estudiantes"
              title="Buscar estudiantes"
            >
              <Icon name="search" size={17} />
            </button>
            <button
              className={`pill ${connection === "online" ? "green" : "orange"}`}
              onClick={() => setConnectionOpen(true)}
              title="Conexión y sincronización"
            >
              {connection === "online" ? "En línea" : connection === "offline" ? "Sin conexión" : "Conectando"}
            </button>
            {!isApoderado && (
              <button
                className="icon-btn"
                onClick={() => goTo("alertas")}
                aria-label="Ver alertas"
                title="Alertas"
              >
                <Icon name="bell" size={17} />
                {pendingAlerts.length > 0 && <span className="dot" />}
              </button>
            )}
            <button
              className="profile"
              onClick={() => setProfileOpen((current) => !current)}
              aria-label="Perfil"
            >
              <span className="avatar">{(user?.fullName ?? "?").slice(0, 1).toUpperCase()}</span>
              <span>
                <strong className="profile-name">{user?.fullName}</strong>
                <small>{roleLabels[user?.role ?? ""] ?? user?.role}</small>
              </span>
              <Icon name="chevron-down" size={14} />
            </button>
            {profileOpen && (
              <div className="profile-menu">
                <div className="fine"><b>{user?.fullName}</b><br />{user?.username}</div>
                {canManage && (
                  <button className="btn secondary slim" onClick={() => goTo("usuarios")}>
                    <Icon name="users" size={14} /> Gestionar cuentas
                  </button>
                )}
                <button className="btn secondary slim" onClick={handleLogout}>
                  <Icon name="log-out" size={14} /> Cerrar sesión
                </button>
              </div>
            )}
          </div>
        </header>

        <main className="content">
          {view === "dashboard" && (
            <>
              <PageHead
                eyebrow="Panel de control"
                title="Dashboard"
                detail={`Resumen de asistencia escolar · Jornada del ${date}`}
                more={
                  <span className="time-label">
                    <Icon name="calendar-days" size={14} />
                    {formatLongDate(date)}
                  </span>
                }
              />

              <section className="hero">
                <div>
                  <div className="eyebrow">Jornada escolar · Piloto demo</div>
                  <h2>Asistencia de hoy</h2>
                  <p>
                    Marca por QR o por lista. Revisa los registros antes de cerrar tu sección.
                  </p>
                  <div className="row">
                    <Btn variant="white" icon="scan-line" onClick={() => goTo("asistencia")}>
                      {canAttend ? "Registrar asistencia" : "Ver asistencia"}
                    </Btn>
                    <Btn variant="ghost" icon="arrow-up-right" onClick={() => goTo("reportes")}>
                      Ver reportes
                    </Btn>
                  </div>
                </div>
                <div className="hero-visual" aria-hidden="true">
                  <div className="scan-frame"><Icon name="qr-code" size={65} /></div>
                  <div className="hero-tag"><Icon name="check" size={13} /> Registro por aula</div>
                </div>
              </section>

              <div className="metrics">
                <Metric
                  icon="users"
                  title="Estudiantes en la demo"
                  value={visibleStudents.length}
                  note={`sección ${section?.displayName ?? sectionId}`}
                />
                <Metric
                  icon="circle-check"
                  title="Asistió"
                  value={attendanceCounts.present + attendanceCounts.late}
                  note={`${attendanceCounts.present} a tiempo`}
                  tone="green"
                />
                <Metric
                  icon="clock"
                  title="Tardanzas"
                  value={attendanceCounts.late}
                  note="registros con hora"
                  tone="orange"
                />
                <Metric
                  icon="circle-alert"
                  title="Faltas injustificadas"
                  value={attendanceCounts.absent}
                  note={`${attendanceCounts.unmarked} sin registrar`}
                  tone="red"
                />
              </div>

              <div className="grid-two">
                <div className="stack">
                  <Card
                    title="Tendencia de asistencia"
                    detail="Últimos cinco días lectivos de la demo"
                    more={
                      <Btn variant="secondary" slim onClick={() => goTo("reportes")}>
                        Ver reportes
                      </Btn>
                    }
                    body={<Chart
                      values={trend}
                      labels={trend.map((item) =>
                        new Intl.DateTimeFormat("es-PE", {
                          timeZone: "UTC",
                          day: "2-digit",
                          month: "short",
                        }).format(new Date(`${item.date}T12:00:00Z`))
                      )}
                    />}
                  />
                  <Card
                    title="Seguimiento por aula"
                    detail="Estado de la jornada seleccionada"
                    body={
                      <Table
                        headers={["Sección", "Turno", "Registros", "Pendientes", "Acción"]}
                        rows={dashboardSections.map((item) => [
                          <strong key="name">{item.displayName}</strong>,
                          item.shift,
                          item.id === sectionId ? visibleStudents.length - attendanceCounts.unmarked : "—",
                          <Pill key="pill" tone={item.id === sectionId && attendanceCounts.unmarked > 0 ? "orange" : "green"}>
                            {item.id === sectionId && attendanceCounts.unmarked > 0
                              ? `${attendanceCounts.unmarked} pendientes`
                              : "Al día"}
                          </Pill>,
                          <Btn
                            key="action"
                            variant="secondary"
                            slim
                            onClick={() => {
                              setSectionId(item.id);
                              goTo("asistencia");
                            }}
                          >
                            Abrir
                          </Btn>,
                        ])}
                        emptyText="No hay secciones disponibles."
                      />
                    }
                  />
                </div>

                <div className="stack">
                  <Card
                    title="Alertas por revisar"
                    detail="Selección reciente de la bandeja"
                    body={
                      <div className="feed">
                        {pendingAlerts.length ? (
                          pendingAlerts.slice(0, 3).map((alert) => (
                            <FeedRow
                              key={alert.id}
                              icon={alert.kind === "threshold" ? "circle-alert" : "bell-ring"}
                              tone={alert.kind === "threshold" ? "orange" : "red"}
                              title={alert.studentName ?? alert.studentId}
                              detail={
                                alert.kind === "threshold"
                                  ? `${alert.count} faltas · Posible citación`
                                  : "Inasistencia · Aviso al apoderado"
                              }
                              trailing={<Pill tone="orange">Pendiente</Pill>}
                            />
                          ))
                        ) : (
                          <div className="empty">La bandeja está al día.</div>
                        )}
                      </div>
                    }
                    more={
                      !isApoderado ? (
                        <button className="link-button" onClick={() => goTo("alertas")}>
                          Abrir bandeja
                        </button>
                      ) : undefined
                    }
                  />
                  <Card
                    title="Turnos de atención"
                    detail="Horario de referencia de la jornada"
                    body={
                      <div className="feed">
                        <FeedRow icon="clock" title="Mañana" detail="08:00 a 13:00 · Primaria" />
                        <FeedRow icon="clock" title="Tarde" detail="13:00 a 18:00 · Primaria" />
                      </div>
                    }
                  />
                </div>
              </div>
            </>
          )}

          {view === "asistencia" && (
            <>
              <PageHead
                eyebrow="Operación escolar"
                title="Asistencia"
                detail="Registro de estudiantes por fecha, sección y turno."
                more={
                  !isClosed ? (
                    <Btn
                      icon="clipboard-check"
                      onClick={() => setCloseConfirm(true)}
                      disabled={busy || pendingCount > 0 || conflictCount > 0 || connection !== "online"}
                    >
                      Cerrar jornada
                    </Btn>
                  ) : isAuthority ? (
                    <Btn variant="secondary" icon="refresh-cw" onClick={() => setReopenConfirm(true)} disabled={busy}>
                      Reabrir jornada
                    </Btn>
                  ) : undefined
                }
              />

              {!isLective && (
                <Notice tone="warn">
                  La fecha seleccionada no es lectiva según el calendario escolar. Revisa el motivo antes de registrar asistencia.
                </Notice>
              )}

              <div className="metrics">
                <Metric
                  icon="list-checks"
                  title="Registrados"
                  value={visibleStudents.length - attendanceCounts.unmarked}
                  note={`De ${visibleStudents.length} estudiantes`}
                />
                <Metric
                  icon="circle-check"
                  title="Asistió a tiempo"
                  value={attendanceCounts.present}
                  note="Asistencia registrada"
                  tone="green"
                />
                <Metric
                  icon="clock"
                  title="Tardanzas"
                  value={attendanceCounts.late}
                  note="Con hora de registro"
                  tone="orange"
                />
                <Metric
                  icon="circle-x"
                  title="Sin registro"
                  value={attendanceCounts.unmarked}
                  note="Por revisar al cierre"
                  tone="red"
                />
              </div>

              <Card
                title="Registro del aula"
                detail={`${section?.displayName ?? sectionId} · ${formatShortDate(date)}`}
                more={<Pill tone={isClosed ? "green" : "blue"}>{isClosed ? "Aula cerrada" : `Turno ${section?.shift ?? "—"}`}</Pill>}
                body={
                  <>
                    <Toolbar>
                      <label>Fecha
                        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
                      </label>
                      <label>Sección
                        <select
                          value={sectionId}
                          onChange={(event) => setSectionId(event.target.value)}
                          disabled={user?.role === "docente" || user?.role === "auxiliar"}
                        >
                          {sections.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.displayName} · {item.shift}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>Método
                        <select
                          value={attendanceMode}
                          onChange={(event) => setAttendanceMode(event.target.value as "list" | "qr")}
                        >
                          <option value="list">Lista manual</option>
                          <option value="qr">Escáner QR</option>
                        </select>
                      </label>
                      <Btn variant="secondary" icon="refresh-cw" slim onClick={() => void syncPending()} disabled={pendingCount === 0 || !navigator.onLine}>
                        Sincronizar cola ({pendingCount})
                      </Btn>
                    </Toolbar>

                    {attendanceMode === "qr" && !isClosed && (
                      <div style={{ padding: "13px 15px", borderBottom: "1px solid var(--line)" }}>
                        <div className="row spread">
                          <div>
                            <h3>Escanear carné</h3>
                            <p className="fine">Enfoca el carné con la cámara o ingresa su código.</p>
                          </div>
                          <Icon name="scan-qr-code" size={27} />
                        </div>
                        <div className="scanning">
                          <Icon name="scan-qr-code" size={44} />
                          <div className="fine">Coloca el código QR del estudiante dentro del recuadro.</div>
                        </div>
                        <video
                          id="sigma-camera"
                          className={`camera ${cameraActive ? "live" : ""}`}
                          playsInline
                          muted
                        />
                        {cameraError && <span className="error">{cameraError}</span>}
                        <div className="row">
                          <Btn variant="secondary" icon="camera" slim onClick={() => void startCamera()}>
                            {cameraActive ? "Detener cámara" : "Activar cámara"}
                          </Btn>
                          <Btn variant="ghost" icon="qr-code" slim onClick={fillTestQr}>Probar QR</Btn>
                        </div>
                        <form
                          className="row"
                          style={{ marginTop: 12 }}
                          onSubmit={(event) => {
                            event.preventDefault();
                            void acceptQr(qrValueInput);
                          }}
                        >
                          <input
                            className="search"
                            value={qrValueInput}
                            onChange={(event) => setQrValueInput(event.target.value)}
                            placeholder="SIGMA:E:… o código del estudiante"
                            aria-label="Código QR o SIAGIE"
                          />
                          <Btn type="submit" icon="check">Registrar</Btn>
                        </form>
                      </div>
                    )}

                    <Table
                      headers={["Estudiante", "Sección", "Hora", "Estado", "Registro"]}
                      rows={visibleStudents.map((student) => {
                        const record = recordByStudent.get(student.id);
                        return [
                          <PersonCell key="person" name={student.name} detail={student.id} />,
                          section?.displayName ?? sectionId,
                          record ? timeFromIso(record.recordedAt) : "—",
                          record ? (
                            <Pill key="status" tone={statusTone[record.status]}>
                              {statusLabels[record.status]}
                            </Pill>
                          ) : (
                            <Pill key="status">Sin registro</Pill>
                          ),
                          <div key="action" className="row" style={{ flexWrap: "nowrap" }}>
                            {record ? (
                              <>
                                <Pill tone={record.syncStatus === "synced" ? "green" : record.syncStatus === "pending" ? "orange" : "red"}>
                                  {record.syncStatus === "synced"
                                    ? "Sincronizado"
                                    : record.syncStatus === "pending"
                                      ? "En cola local"
                                      : "Conflicto"}
                                </Pill>
                                {record.syncStatus === "conflict" && (
                                  <Btn variant="warn" slim onClick={() => setConflictDiscard(record)}>
                                    Descartar local
                                  </Btn>
                                )}
                                {isAuthority && record.id && record.syncStatus === "synced" && (
                                  <Btn
                                    variant="secondary"
                                    slim
                                    icon="file-text"
                                    onClick={() => setCorrection({
                                      recordId: record.id!,
                                      studentName: student.name,
                                      status: record.status,
                                      reason: record.reason ?? "",
                                    })}
                                  >
                                    Revisar
                                  </Btn>
                                )}
                                {record.reason && <small>{record.reason}</small>}
                              </>
                            ) : (
                              <Btn
                                variant="secondary"
                                slim
                                icon="check"
                                disabled={isClosed || loading}
                                onClick={() => setMarkDialog({
                                  studentId: student.id,
                                  status: "present",
                                  clock: peruClock().slice(0, 5),
                                })}
                              >
                                Marcar
                              </Btn>
                            )}
                          </div>,
                        ];
                      })}
                      emptyText="No hay estudiantes habilitados en esta sección para la fecha."
                    />
                    <Summary>
                      Registros del {formatShortDate(date)} · {section?.displayName ?? sectionId} ·{" "}
                      {sourceLabel(records[0]?.source)}
                    </Summary>
                  </>
                }
              />
            </>
          )}

          {view === "estudiantes" && <Students user={user} />}
          {view === "personal" && <Personnel user={user} />}
          {view === "apoderados" && <Guardians user={user} />}
          {view === "alertas" && <Alerts user={user} />}
          {view === "justificaciones" && <Futs user={user} />}
          {view === "reportes" && <Reports user={user} />}
          {view === "calendario" && <Calendar user={user} />}
          {view === "carnes" && <Credentials user={user} />}
          {view === "usuarios" && <Users user={user} />}
          {view === "bitacora" && <Audit user={user} />}
          {view === "configuracion" && <Settings user={user} />}
          {view === "familia" && <Familia user={user} />}
        </main>
      </div>

      <Modal
        open={Boolean(markDialog)}
        title="Registrar asistencia"
        onClose={() => setMarkDialog(null)}
        body={
          markDialog ? (
            <form
              id="mark-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitMark();
              }}
            >
              <p className="fine" style={{ marginBottom: 14 }}>
                {students.find((item) => item.id === markDialog.studentId)?.name} · {section?.displayName}
              </p>
              <div className="form-field">
                <label htmlFor="mark-status">Estado</label>
                <select
                  id="mark-status"
                  value={markDialog.status}
                  onChange={(event) =>
                    setMarkDialog({ ...markDialog, status: event.target.value as AttendanceStatus })
                  }
                >
                  {(["present", "late", "absent", "permit"] as AttendanceStatus[]).map((status) => (
                    <option key={status} value={status}>{statusLabels[status]}</option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="mark-clock">Hora de Perú</label>
                <input
                  id="mark-clock"
                  type="time"
                  value={markDialog.clock}
                  onChange={(event) => setMarkDialog({ ...markDialog, clock: event.target.value })}
                />
              </div>
            </form>
          ) : null
        }
        footer={
          <>
            <Btn variant="secondary" onClick={() => setMarkDialog(null)}>Cancelar</Btn>
            <Btn type="submit" form="mark-form" disabled={busy}>Guardar</Btn>
          </>
        }
      />

      <Modal
        open={closeConfirm}
        title="Cerrar jornada"
        onClose={() => setCloseConfirm(false)}
        body={
          <>
            <p className="fine">
              ¿Cerrar la jornada de {section?.displayName ?? sectionId}? Los estudiantes sin marcación
              quedarán como faltantes.
            </p>
            <div className="notice warn" style={{ marginTop: 12 }}>
              Se generarán {attendanceCounts.unmarked} falta(s) por cierre y las alertas correspondientes.
            </div>
          </>
        }
        footer={
          <>
            <Btn variant="secondary" onClick={() => setCloseConfirm(false)}>Cancelar</Btn>
            <Btn onClick={() => void commitClose()} disabled={busy}>Cerrar jornada</Btn>
          </>
        }
      />

      <Modal
        open={Boolean(conflictDiscard)}
        title="Descartar registro local"
        onClose={() => setConflictDiscard(null)}
        body={
          <p className="fine">
            Se conservarán los datos que ya existan en el servidor para este estudiante.
          </p>
        }
        footer={
          <>
            <Btn variant="secondary" onClick={() => setConflictDiscard(null)}>Cancelar</Btn>
            <Btn variant="warn" onClick={() => void commitConflictDiscard()}>Descartar local</Btn>
          </>
        }
      />

      <Modal
        open={Boolean(correction)}
        title="Revisar registro"
        onClose={() => setCorrection(null)}
        body={
          correction ? (
            <form
              id="correction-form"
              onSubmit={(event) => {
                event.preventDefault();
                void submitCorrection();
              }}
            >
              <p className="fine" style={{ marginBottom: 14 }}>
                {correction.studentName} · {date}
              </p>
              <div className="form-field">
                <label htmlFor="correction-status">Estado</label>
                <select
                  id="correction-status"
                  value={correction.status}
                  onChange={(event) =>
                    setCorrection({ ...correction, status: event.target.value as AttendanceStatus })
                  }
                >
                  {(Object.keys(statusLabels) as AttendanceStatus[]).map((status) => (
                    <option key={status} value={status}>{statusLabels[status]}</option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label htmlFor="correction-reason">Motivo o referencia FUT</label>
                <textarea
                  id="correction-reason"
                  value={correction.reason}
                  onChange={(event) => setCorrection({ ...correction, reason: event.target.value })}
                  required
                  rows={3}
                />
              </div>
            </form>
          ) : null
        }
        footer={
          <>
            <Btn variant="secondary" onClick={() => setCorrection(null)}>Cancelar</Btn>
            <Btn type="submit" form="correction-form" disabled={busy}>Guardar corrección</Btn>
          </>
        }
      />

      <Modal
        open={globalSearchOpen}
        title="Búsqueda global"
        onClose={() => setGlobalSearchOpen(false)}
        body={
          <div className="stack">
            <div className="form-field">
              <label htmlFor="global-query">Buscar en módulos y estudiantes</label>
              <input
                id="global-query"
                autoFocus
                value={globalQuery}
                onChange={(event) => setGlobalQuery(event.target.value)}
                placeholder="Escribe un módulo, nombre o código SIAGIE"
              />
            </div>
            <div className="form-grid">
              <div>
                <h3>Módulos</h3>
                <label className="fine" htmlFor="module-search">Filtrar módulos</label>
                <input
                  id="module-search"
                  value={navSearch}
                  onChange={(event) => setNavSearch(event.target.value)}
                  placeholder="Módulo"
                />
                <div className="feed" style={{ marginTop: 8 }}>
                  {moduleMatches.slice(0, 8).map((item) => (
                    <button
                      key={item.id}
                      className="feed-row"
                      onClick={() => goTo(item.id)}
                    >
                      <Icon name={navIcons[item.id] ?? "info"} size={16} />
                      <span>{navLabels[item.id]}</span>
                      <small>{item.group}</small>
                    </button>
                  ))}
                  {moduleMatches.length === 0 && <div className="fine">Sin módulos coincidentes.</div>}
                </div>
              </div>
              <div>
                <h3>Estudiantes</h3>
                <label className="fine" htmlFor="student-search">Filtrar estudiantes</label>
                <input
                  id="student-search"
                  value={studentQuery}
                  onChange={(event) => setStudentQuery(event.target.value)}
                  placeholder="Nombre o código"
                />
                <div className="feed" style={{ marginTop: 8 }}>
                  {studentMatches.map((item) => (
                    <button
                      key={item.id}
                      className="feed-row"
                      onClick={() => {
                        goTo("estudiantes");
                        setMessage(`Estudiante localizado: ${item.name}.`);
                      }}
                    >
                      <Icon name="user-round" size={16} />
                      <span>{item.name}</span>
                      <small>{item.id}</small>
                    </button>
                  ))}
                  {studentMatches.length === 0 && <div className="fine">Sin estudiantes en el aula activa.</div>}
                </div>
              </div>
            </div>
          </div>
        }
        footer={
          <Btn variant="secondary" onClick={() => setGlobalSearchOpen(false)}>Cerrar</Btn>
        }
      />

      <Modal
        open={connectionOpen}
        title="Conexión y sincronización"
        onClose={() => setConnectionOpen(false)}
        body={
          <div className="stack">
            <Notice tone={connection === "offline" ? "warn" : "good"}>
              {demoOffline
                ? "Desconexión simulada activa. Los registros nuevos se guardan en la cola local."
                : connection === "offline"
                  ? "Sin conexión. Los registros nuevos se guardan en la cola local."
                  : "Conexión disponible. Puedes sincronizar la cola local cuando lo necesites."}
            </Notice>
            <p className="fine">Registros pendientes de sincronizar: <strong>{pendingCount}</strong>.</p>
            <p className="fine">
              Los datos offline se conservan en este equipo mediante IndexedDB y se envían al servidor al reconectar.
            </p>
          </div>
        }
        footer={
          <div className="row right">
            <Btn variant="secondary" icon={demoOffline ? "wifi" : "wifi-off"} onClick={toggleDemoOffline}>
              {demoOffline ? "Restaurar conexión" : "Simular desconexión"}
            </Btn>
            <Btn icon="refresh-cw" onClick={() => void syncPending()} disabled={demoOffline || pendingCount === 0}>
              Sincronizar ahora
            </Btn>
          </div>
        }
      />

      <Modal
        open={reopenConfirm}
        title="Reabrir jornada"
        onClose={() => setReopenConfirm(false)}
        body={
          <p className="fine">
            ¿Reabrir la jornada de {section?.displayName ?? sectionId}? Podrás revisar y corregir registros ya guardados.
          </p>
        }
        footer={
          <div className="row right">
            <Btn variant="secondary" onClick={() => setReopenConfirm(false)}>Cancelar</Btn>
            <Btn
              icon="refresh-cw"
              disabled={busy}
              onClick={() => {
                setReopenConfirm(false);
                void reopenSession();
              }}
            >
              Reabrir
            </Btn>
          </div>
        }
      />

      <Modal
        open={helpOpen}
        title="Recuperar acceso"
        onClose={() => setHelpOpen(false)}
        body={
          <div className="stack">
            {!resetChallenge ? (
              <>
                <Notice>
                  El código se valida contra el celular previamente registrado en la cuenta. Las cuentas sin teléfono
                  deben solicitar a Dirección que lo registre.
                </Notice>
                <div className="form-field">
                  <label htmlFor="reset-username">Usuario</label>
                  <input
                    id="reset-username"
                    value={resetUsername}
                    onChange={(event) => setResetUsername(event.target.value)}
                    autoComplete="username"
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="reset-phone">Celular registrado</label>
                  <input
                    id="reset-phone"
                    inputMode="numeric"
                    maxLength={9}
                    value={resetPhone}
                    onChange={(event) => setResetPhone(event.target.value.replace(/\D/g, ""))}
                    placeholder="9 dígitos"
                  />
                </div>
                <Btn onClick={() => void requestPasswordCode()}>Solicitar código SMS</Btn>
              </>
            ) : (
              <>
                <Notice>{message || "Ingresa el código de 6 dígitos enviado al celular registrado."}</Notice>
                {resetPreviewCode && (
                  <Notice tone="warn">
                    Modo de pruebas: no se envió un SMS. Código: <strong>{resetPreviewCode}</strong>
                  </Notice>
                )}
                <div className="form-field">
                  <label htmlFor="reset-otp">Código de verificación</label>
                  <input
                    id="reset-otp"
                    inputMode="numeric"
                    maxLength={6}
                    value={resetOtp}
                    onChange={(event) => setResetOtp(event.target.value.replace(/\D/g, ""))}
                  />
                </div>
                <div className="form-field">
                  <label htmlFor="reset-new-password">Nueva contraseña (mínimo 10 caracteres)</label>
                  <input
                    id="reset-new-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={10}
                    value={resetNewPassword}
                    onChange={(event) => setResetNewPassword(event.target.value)}
                  />
                </div>
                {error && <Notice tone="warn">{error}</Notice>}
                <Btn onClick={() => void verifyPasswordCode()}>Restablecer contraseña</Btn>
              </>
            )}
          </div>
        }
        footer={<Btn variant="secondary" onClick={() => setHelpOpen(false)}>Cerrar</Btn>}
      />

      {(message || error) && (
        <div className="toasts">
          {error && <div className="toast error-tone"><Icon name="circle-alert" size={17} />{error}</div>}
          {message && <div className="toast"><Icon name="circle-check" size={17} />{message}</div>}
        </div>
      )}
    </div>
  );
}
