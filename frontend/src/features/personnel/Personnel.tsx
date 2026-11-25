import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { cachePersonnel, readPersonnel } from "../../offlineDb";
import { ImportDialog } from "../../shared/ImportDialog";
import { peruTodayIso } from "../../shared/time";
import {
  Btn,
  Card,
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
} from "../../shared/ui";
import type { Personnel, StaffLog, AuthUser } from "../../types";

interface PersonnelProps {
  user: AuthUser;
}

interface StaffForm {
  id: string;
  name: string;
  role: string;
  shift: "Mañana" | "Tarde";
  doc: string;
  contact: string;
  active: boolean;
}

interface StaffEditor {
  id: string | null;
  form: StaffForm;
}

interface MarkForm {
  personnelId: string;
  personName: string;
  logDate: string;
  kind: "in" | "out";
  clock: string;
}

function todayIso(): string {
  return peruTodayIso();
}

function peruClock(): string {
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

function isClock(value: string): boolean {
  return /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
}

function formatStaffClock(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const timeOnly = value.match(/^(\d{2}:\d{2}(?::\d{2})?)/);
  if (timeOnly) return timeOnly[1].slice(0, 5);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(parsed);
}

function validateStaffForm(form: StaffForm, editing: boolean): string {
  if (!editing && !form.id.trim()) return "Ingresa el código de personal.";
  if (!form.name.trim()) return "Ingresa el nombre completo.";
  if (!form.role.trim()) return "Ingresa el cargo.";
  if (form.shift !== "Mañana" && form.shift !== "Tarde") return "Selecciona un turno válido.";
  return "";
}

function validateMarkForm(form: MarkForm): string {
  if (!isIsoDate(form.logDate)) return "Selecciona una fecha válida.";
  if (!isClock(form.clock)) return "Ingresa una hora válida (HH:mm).";
  return "";
}

export function Personnel({ user }: PersonnelProps) {
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [staffEditor, setStaffEditor] = useState<StaffEditor | null>(null);
  const [markEditor, setMarkEditor] = useState<MarkForm | null>(null);
  const [staffDate, setStaffDate] = useState(todayIso);
  const [staffLogs, setStaffLogs] = useState<StaffLog[]>([]);
  const [logsError, setLogsError] = useState("");
  const [message, setMessage] = useState("");
  const [shiftFilter, setShiftFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const canManage = ["direccion", "subdireccion", "pip", "oficina"].includes(user.role);
  const canImport = canManage;

  const loadPersonnel = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.personnel();
      setPersonnel(data);
      await cachePersonnel(data);
    } catch (err: any) {
      try {
        const cached = await readPersonnel();
        setPersonnel(cached);
        setError("Usando datos en caché (sin conexión).");
      } catch {
        setError("No se pudieron cargar los registros de personal.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  const loadStaffLogs = useCallback(async () => {
    try {
      const logs = await api.staffLogs(staffDate);
      setLogsError("");
      setStaffLogs(logs.map((log) => ({
        ...log,
        inTime: formatStaffClock(log.inTime),
        outTime: formatStaffClock(log.outTime),
      })));
    } catch (err) {
      setStaffLogs([]);
      setLogsError(
        err instanceof Error
          ? `No se pudieron cargar las marcaciones: ${err.message}`
          : "No se pudieron cargar las marcaciones del personal."
      );
    }
  }, [staffDate]);

  useEffect(() => {
    void loadPersonnel();
  }, [loadPersonnel]);

  useEffect(() => {
    void loadStaffLogs();
  }, [loadStaffLogs]);

  const shifts = useMemo(() => [...new Set(personnel.map((p) => p.shift))].sort(), [personnel]);

  const filtered = useMemo(() => {
    return personnel.filter((p) => !shiftFilter || p.shift === shiftFilter);
  }, [personnel, shiftFilter]);

  const logsForDate = useMemo(
    () => staffLogs.filter((log) => log.logDate === staffDate),
    [staffLogs, staffDate]
  );
  const checkIns = logsForDate.filter((log) => Boolean(log.inTime)).length;
  const checkOuts = logsForDate.filter((log) => Boolean(log.outTime)).length;

  function updateStaffField<K extends keyof StaffForm>(field: K, value: StaffForm[K]) {
    setStaffEditor((current) =>
      current ? { ...current, form: { ...current.form, [field]: value } } : current
    );
  }

  function openStaffForm(person?: Personnel) {
    setMessage("");
    setError("");
    setStaffEditor({
      id: person?.id ?? null,
      form: {
        id: person?.id ?? "",
        name: person?.name ?? "",
        role: person?.role ?? "",
        shift: person?.shift ?? "Mañana",
        doc: person?.doc ?? "",
        contact: person?.contact ?? "",
        active: person ? person.active : true,
      },
    });
  }

  function openMarkForm(person: Personnel, kind: "in" | "out") {
    setMessage("");
    setError("");
    setMarkEditor({
      personnelId: person.id,
      personName: person.name,
      logDate: staffDate,
      kind,
      clock: peruClock(),
    });
  }

  async function saveStaff() {
    if (!staffEditor) return;
    const { id, form } = staffEditor;
    const problem = validateStaffForm(form, Boolean(id));
    if (problem) {
      setMessage("");
      setError(problem);
      return;
    }
    setMessage("");
    setError("");
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      role: form.role.trim(),
      shift: form.shift,
      contact: form.contact.trim() || undefined,
      doc: form.doc.trim() || undefined,
      active: form.active,
    };
    try {
      if (id) {
        await api.updatePersonnel(id, body);
        setMessage("Ficha de personal actualizada.");
      } else {
        await api.createPersonnel({ ...body, id: form.id.trim() });
        setMessage("Personal agregado correctamente.");
      }
      setStaffEditor(null);
      await loadPersonnel();
    } catch (err: any) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la ficha de personal.");
    }
  }

  function applyMarkResult(mark: MarkForm, result: unknown) {
    const data = (result ?? {}) as { in_time?: unknown; out_time?: unknown };
    const inTime = formatStaffClock(data.in_time);
    const outTime = formatStaffClock(data.out_time);
    setStaffLogs((current) => {
      const index = current.findIndex(
        (log) => log.personnelId === mark.personnelId && log.logDate === mark.logDate
      );
      const existing = index >= 0 ? current[index] : undefined;
      const next: StaffLog = {
        id: existing?.id ?? `${mark.personnelId}|${mark.logDate}`,
        personnelId: mark.personnelId,
        logDate: mark.logDate,
        inTime: inTime ?? existing?.inTime,
        outTime: outTime ?? existing?.outTime,
        source: "Manual",
      };
      if (index >= 0) {
        const updated = [...current];
        updated[index] = next;
        return updated;
      }
      return [...current, next];
    });
  }

  async function saveMark() {
    if (!markEditor) return;
    const problem = validateMarkForm(markEditor);
    if (problem) {
      setMessage("");
      setError(problem);
      return;
    }
    setMessage("");
    setError("");
    try {
      const result = await api.markStaff({
        personnel_id: markEditor.personnelId,
        log_date: markEditor.logDate,
        kind: markEditor.kind,
        clock: markEditor.clock,
        source: "Manual",
      });
      applyMarkResult(markEditor, result);
      setMessage(
        `Se registró ${markEditor.kind === "in" ? "el ingreso" : "la salida"} de ${markEditor.personName}.`
      );
      setMarkEditor(null);
      await Promise.all([loadPersonnel(), loadStaffLogs()]);
    } catch (err: any) {
      setError(err instanceof Error ? err.message : "No se pudo registrar la marcación.");
    }
  }

  if (loading) {
    return (
      <div className="stack">
        <Notice>Cargando personal…</Notice>
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHead
        eyebrow="Operación escolar"
        title="Personal"
        detail="Docentes y administrativos · Ingresos y salidas del turno."
        more={
          <div className="row">
            {canImport && (
              <Btn variant="secondary" icon="upload" onClick={() => setShowImport(true)}>
                Importar marcaciones
              </Btn>
            )}
            {canManage && (
              <Btn icon="plus" onClick={() => openStaffForm()}>
                Agregar personal
              </Btn>
            )}
          </div>
        }
      />

      <Notice>
        Registra ingresos y salidas con la fecha y hora de Perú; cada marcación se valida y guarda en el servidor.
      </Notice>

      {message && <Notice tone="good">{message}</Notice>}
      {error && <Notice tone="warn">{error}</Notice>}
      {logsError && <Notice tone="warn">{logsError}</Notice>}

      <div className="metrics">
        <Metric
          icon="users"
          title="Personal demo"
          value={personnel.length}
          note="Docentes y administrativos"
        />
        <Metric
          icon="check"
          title="Ingresos"
          value={checkIns}
          note={`Fecha: ${staffDate}`}
          tone="green"
        />
        <Metric
          icon="log-out"
          title="Salidas"
          value={checkOuts}
          note={`Fecha: ${staffDate}`}
          tone="orange"
        />
        <Metric
          icon="shield-check"
          title="Control actual"
          value="Reloj"
          note="Huella y reconocimiento facial"
        />
      </div>

      <Card
        title="Nómina y marcaciones"
        detail="Hora de Perú"
        body={
          <>
            <Toolbar>
              <label>
                <span className="row" style={{ gap: 4 }}>
                  <Icon name="calendar-days" size={14} />
                  Fecha
                </span>
                <input
                  type="date"
                  value={staffDate}
                  onChange={(e) => setStaffDate(e.target.value)}
                />
              </label>
              <label>
                Turno
                <select
                  value={shiftFilter}
                  onChange={(e) => setShiftFilter(e.target.value)}
                >
                  <option value="">Ambos</option>
                  {shifts.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
            </Toolbar>
            <Table
              headers={["Personal", "Cargo", "Turno", "Ingreso", "Salida", "Estado", "Contacto", "Acciones"]}
              rows={filtered.map((p) => {
                const log = logsForDate.find((item) => item.personnelId === p.id);
                return [
                  <PersonCell
                    key={`${p.id}-person`}
                    name={p.name}
                    detail={p.doc ? `DNI: ${p.doc}` : undefined}
                  />,
                  p.role,
                  p.shift,
                  log?.inTime ?? <span className="muted">—</span>,
                  log?.outTime ?? <span className="muted">—</span>,
                  <Pill key={`${p.id}-status`} tone={p.active ? "green" : "orange"}>
                    {p.active ? "Activo" : "Inactivo"}
                  </Pill>,
                  p.contact || "—",
                  <div key={`${p.id}-actions`} className="row">
                    {canManage ? (
                      <>
                        <Btn variant="secondary" slim icon="clock" onClick={() => openMarkForm(p, "in")}>
                          Marcar ingreso
                        </Btn>
                        <Btn variant="secondary" slim icon="log-out" onClick={() => openMarkForm(p, "out")}>
                          Marcar salida
                        </Btn>
                        <Btn variant="ghost" slim onClick={() => openStaffForm(p)}>
                          Editar
                        </Btn>
                      </>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </div>,
                ];
              })}
              emptyText="No hay personal registrado."
            />
            <Summary>
              {filtered.length} registros en la vista de {personnel.length} totales.
            </Summary>
          </>
        }
      />

      {showImport && (
        <ImportDialog
          type="staff"
          sections={[]}
          onClose={() => setShowImport(false)}
          onDone={(text) => {
            setMessage(text);
            void loadPersonnel();
          }}
        />
      )}

      <Modal
        open={Boolean(staffEditor)}
        onClose={() => setStaffEditor(null)}
        title={staffEditor?.id ? "Editar personal" : "Agregar personal"}
        body={staffEditor ? (
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="staff-id">Código de personal</label>
              <input
                id="staff-id"
                type="text"
                value={staffEditor.form.id}
                onChange={(e) => updateStaffField("id", e.target.value)}
                placeholder="Ej. P-001"
                disabled={Boolean(staffEditor.id)}
                required
              />
              {staffEditor.id && <span className="fine">El código no se puede modificar.</span>}
            </div>
            <div className="form-field">
              <label htmlFor="staff-doc">DNI (opcional)</label>
              <input
                id="staff-doc"
                type="text"
                maxLength={12}
                value={staffEditor.form.doc}
                onChange={(e) => updateStaffField("doc", e.target.value)}
              />
            </div>
            <div className="form-field wide">
              <label htmlFor="staff-name">Nombre completo</label>
              <input
                id="staff-name"
                type="text"
                value={staffEditor.form.name}
                onChange={(e) => updateStaffField("name", e.target.value)}
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="staff-role">Cargo</label>
              <input
                id="staff-role"
                type="text"
                value={staffEditor.form.role}
                onChange={(e) => updateStaffField("role", e.target.value)}
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="staff-shift">Turno</label>
              <select
                id="staff-shift"
                value={staffEditor.form.shift}
                onChange={(e) => updateStaffField("shift", e.target.value as StaffForm["shift"])}
              >
                <option value="Mañana">Mañana</option>
                <option value="Tarde">Tarde</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="staff-contact">Contacto</label>
              <input
                id="staff-contact"
                type="text"
                value={staffEditor.form.contact}
                onChange={(e) => updateStaffField("contact", e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="staff-active">Estado</label>
              <select
                id="staff-active"
                value={staffEditor.form.active ? "active" : "inactive"}
                onChange={(e) => updateStaffField("active", e.target.value === "active")}
              >
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
              </select>
            </div>
          </div>
        ) : null}
        footer={
          <div className="row right">
            <Btn variant="secondary" onClick={() => setStaffEditor(null)}>Cancelar</Btn>
            <Btn icon="check" onClick={() => void saveStaff()}>Guardar</Btn>
          </div>
        }
      />

      <Modal
        open={Boolean(markEditor)}
        onClose={() => setMarkEditor(null)}
        title={markEditor
          ? `Marcar ${markEditor.kind === "in" ? "ingreso" : "salida"} · ${markEditor.personName}`
          : "Marcar asistencia"}
        body={markEditor ? (
          <>
            <div className="form-grid">
              <div className="form-field wide">
                <label htmlFor="mark-person">Personal</label>
                <input id="mark-person" type="text" value={markEditor.personName} disabled />
              </div>
              <div className="form-field">
                <label htmlFor="mark-date">Fecha</label>
                <input
                  id="mark-date"
                  type="date"
                  value={markEditor.logDate}
                  onChange={(e) => setMarkEditor((current) => current ? { ...current, logDate: e.target.value } : current)}
                  required
                />
              </div>
              <div className="form-field">
                <label htmlFor="mark-kind">Marcación</label>
                <select
                  id="mark-kind"
                  value={markEditor.kind}
                  onChange={(e) => setMarkEditor((current) => current ? { ...current, kind: e.target.value as MarkForm["kind"] } : current)}
                >
                  <option value="in">Ingreso</option>
                  <option value="out">Salida</option>
                </select>
              </div>
              <div className="form-field wide">
                <label htmlFor="mark-clock">Hora de Perú</label>
                <input
                  id="mark-clock"
                  type="time"
                  step={1}
                  value={markEditor.clock}
                  onChange={(e) => setMarkEditor((current) => current ? { ...current, clock: e.target.value } : current)}
                  required
                />
              </div>
            </div>
            <p className="fine" style={{ marginTop: 12 }}>
              La marcación se enviará al servidor con la fecha y hora indicadas.
            </p>
          </>
        ) : null}
        footer={
          <div className="row right">
            <Btn variant="secondary" onClick={() => setMarkEditor(null)}>Cancelar</Btn>
            <Btn icon="check" onClick={() => void saveMark()}>Registrar</Btn>
          </div>
        }
      />
    </div>
  );
}
