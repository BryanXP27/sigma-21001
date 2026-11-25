import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import {
  Card,
  Empty,
  Icon,
  Metric,
  Notice,
  PageHead,
  Pill,
  Table,
  Toolbar,
} from "../../shared/ui";
import type { AuthUser } from "../../types";

interface FamiliaProps {
  user: AuthUser;
}

interface FamilyRecord {
  id: string;
  date: string;
  status: string;
  source: string;
  recordedAt: string;
}

interface FamilyStudent {
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
  records: FamilyRecord[];
}

const statusLabels: Record<string, string> = {
  present: "Asistió",
  late: "Tardanza",
  absent: "Falta injustificada",
  excused: "Falta justificada",
  permit: "Permiso",
  none: "Sin registro",
};

const statusTones: Record<string, "" | "green" | "orange" | "red" | "blue"> = {
  present: "green",
  late: "orange",
  absent: "red",
  excused: "blue",
  permit: "blue",
  none: "",
};

export function Familia({ user }: FamiliaProps) {
  const [students, setStudents] = useState<FamilyStudent[]>([]);
  const [guardianName, setGuardianName] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadOverview = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.familyOverview();
      setStudents(data.students);
      setGuardianName(data.guardianName ?? user.fullName);
      setSelectedId((current) =>
        data.students.some((s) => s.studentId === current)
          ? current
          : (data.students[0]?.studentId ?? "")
      );
    } catch (err: any) {
      setError(err?.message ?? "No se pudo cargar la información familiar.");
    } finally {
      setLoading(false);
    }
  }, [user.fullName]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  const selected = useMemo(
    () => students.find((s) => s.studentId === selectedId) ?? null,
    [students, selectedId]
  );

  const counts = selected?.counts ?? {
    present: 0,
    late: 0,
    absent: 0,
    excused: 0,
    permit: 0,
  };

  if (loading) {
    return (
      <div className="empty">
        <Icon name="refresh-cw" size={22} />
        Cargando asistencia de mis hijos…
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHead
        eyebrow="Portal de apoderados"
        title="Asistencia de mis hijos"
        detail="Consulta de asistencia para la familia vinculada al perfil de demostración."
      />

      {error && <Notice tone="warn">{error}</Notice>}

      {students.length === 0 ? (
        <Empty>Todavía no hay un estudiante vinculado a este perfil de apoderado.</Empty>
      ) : (
        <>
          <Toolbar>
            <label>
              Estudiante
              <select
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                {students.map((student) => (
                  <option key={student.studentId} value={student.studentId}>
                    {student.name}
                    {student.sectionLabel ? ` · ${student.sectionLabel}` : ""}
                  </option>
                ))}
              </select>
            </label>
          </Toolbar>

          {selected && (
            <>
              <section className="hero">
                <div>
                  <div className="eyebrow">Mi familia</div>
                  <h2>{selected.name}</h2>
                  <p>
                    {selected.sectionLabel ?? "Sin sección asignada"} · I.E.P. Zoilo Candela Sánchez
                  </p>
                  <div className="row">
                    <Pill>{selected.relation ?? "Apoderado"}: {guardianName}</Pill>
                  </div>
                </div>
                <div className="hero-visual" aria-hidden="true">
                  <div className="scan-frame">
                    <Icon name="graduation-cap" size={65} />
                  </div>
                  <div className="hero-tag">
                    <Icon name="check" size={13} /> Registro familiar
                  </div>
                </div>
              </section>

              <div className="metrics">
                <Metric
                  icon="check"
                  title="A tiempo"
                  value={counts.present}
                  note="Registros disponibles"
                  tone="green"
                />
                <Metric
                  icon="clock"
                  title="Tardanzas"
                  value={counts.late}
                  note="Registros disponibles"
                  tone="orange"
                />
                <Metric
                  icon="circle-alert"
                  title="Faltas injustificadas"
                  value={counts.absent}
                  note="Registros disponibles"
                  tone="red"
                />
                <Metric
                  icon="clipboard-check"
                  title="Faltas justificadas"
                  value={counts.excused}
                  note="Registros disponibles"
                />
              </div>

              <Card
                title="Historial de asistencia"
                detail="Solo se muestran los registros del estudiante vinculado."
                body={
                  <Table
                    headers={["Fecha", "Hora", "Estado", "Origen"]}
                    rows={selected.records.map((record) => [
                      record.date,
                      new Date(record.recordedAt).toLocaleTimeString("es-PE", {
                        timeZone: "America/Lima",
                        hour: "2-digit",
                        minute: "2-digit",
                      }),
                      <Pill key={record.id} tone={statusTones[record.status] ?? ""}>
                        {statusLabels[record.status] ?? record.status}
                      </Pill>,
                      record.source === "qr"
                        ? "QR"
                        : record.source === "closure"
                          ? "Cierre de jornada"
                          : "Manual",
                    ])}
                    emptyText="No hay registros de asistencia."
                  />
                }
              />
            </>
          )}
        </>
      )}
    </div>
  );
}
