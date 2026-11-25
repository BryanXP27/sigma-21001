import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../api";
import { cacheFuts, readFuts } from "../../../offlineDb";
import { peruTodayIso } from "../../../shared/time";
import {
  Btn,
  Card,
  Modal,
  Notice,
  PageHead,
  PersonCell,
  Pill,
  Summary,
  Table,
  Toolbar,
} from "../../../shared/ui";
import type { Fut, AuthUser } from "../../../types";

interface FutsProps {
  user: AuthUser;
}

const RESOLVE_ROLES = ["direccion", "subdireccion"];
const CREATE_ROLES = ["direccion", "subdireccion", "pip", "oficina", "docente", "auxiliar"];

function futStatusTone(status: Fut["status"]): "orange" | "green" | "red" {
  if (status === "Pendiente") return "orange";
  if (status === "Aprobada") return "green";
  return "red";
}

export function Futs({ user }: FutsProps) {
  const [futs, setFuts] = useState<Fut[]>([]);
  const [filter, setFilter] = useState("Todos");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedFut, setSelectedFut] = useState<Fut | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [formStudentId, setFormStudentId] = useState("");
  const [formDate, setFormDate] = useState(peruTodayIso);
  const [formRef, setFormRef] = useState("");
  const [formReason, setFormReason] = useState("");

  const canResolve = (fut: Fut) =>
    fut.status === "Pendiente" && RESOLVE_ROLES.includes(user.role);
  const canCreate = CREATE_ROLES.includes(user.role);

  const loadFuts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.futs();
      setFuts(data);
      await cacheFuts(data);
    } catch (err: any) {
      try {
        const cached = await readFuts();
        setFuts(cached);
        setError("Usando datos en caché (sin conexión).");
      } catch {
        setError("No se pudieron cargar las solicitudes FUT.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadFuts();
  }, [loadFuts]);

  const filtered = useMemo(() => {
    if (filter === "Todos") return futs;
    return futs.filter((f) => f.status === filter);
  }, [futs, filter]);

  const handleResolve = async (id: string, result: "Aprobada" | "Rechazada") => {
    if (!RESOLVE_ROLES.includes(user.role)) return;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await api.resolveFut(id, result);
      setMessage(result === "Aprobada" ? "FUT aprobado." : "FUT rechazado.");
      setSelectedFut(null);
      await loadFuts();
    } catch (err: any) {
      setError(err?.message ?? "Error al resolver el FUT.");
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async () => {
    if (!/^\d{14}$/.test(formStudentId.trim())) {
      setError("El código SIAGIE debe tener 14 dígitos.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(formDate)) {
      setError("Selecciona una fecha de inasistencia válida.");
      return;
    }
    if (!formRef.trim()) {
      setError("Ingresa el número o referencia del FUT.");
      return;
    }
    if (!formReason.trim()) {
      setError("Ingresa el motivo de la solicitud.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      await api.createFut({
        student_id: formStudentId.trim(),
        fut_date: formDate,
        ref: formRef.trim(),
        reason: formReason.trim(),
      });
      setMessage("FUT registrado correctamente.");
      setShowCreate(false);
      setFormStudentId("");
      setFormDate(peruTodayIso());
      setFormRef("");
      setFormReason("");
      await loadFuts();
    } catch (err: any) {
      setError(err?.message ?? "No se pudo registrar el FUT.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="empty">Cargando solicitudes FUT…</div>;
  }

  return (
    <>
      <PageHead
        eyebrow="Seguimiento"
        title="Justificaciones FUT"
        detail="Registra solicitudes y revisa el sustento de una falta."
        more={
          canCreate && (
            <Btn
              icon="plus"
              onClick={() => {
                setError("");
                setShowCreate(true);
              }}
            >
              Registrar FUT
            </Btn>
          )
        }
      />

      {error && <Notice tone="warn">{error}</Notice>}
      {message && <Notice tone="good">{message}</Notice>}

      <Card
        title="Solicitudes de justificación"
        detail="La aprobación corresponde a Dirección o Subdirección."
        body={
          <>
            <Toolbar>
              <label>
                Estado
                <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                  <option value="Todos">Todos los estados</option>
                  <option value="Pendiente">Pendiente</option>
                  <option value="Aprobada">Aprobada</option>
                  <option value="Rechazada">Rechazada</option>
                </select>
              </label>
            </Toolbar>
            <Table
              headers={["FUT", "Estudiante", "Fecha de falta", "Estado", "Acción"]}
              rows={filtered.map((f) => [
                f.ref,
                <PersonCell name={f.studentName || "—"} />,
                f.futDate,
                <Pill tone={futStatusTone(f.status)}>{f.status}</Pill>,
                <Btn
                  variant="secondary"
                  slim
                  icon="file-text"
                  onClick={() => setSelectedFut(f)}
                >
                  Revisar
                </Btn>,
              ])}
              emptyText="No hay solicitudes FUT para los filtros seleccionados."
            />
            <Summary>{filtered.length} solicitudes en la vista</Summary>
          </>
        }
      />

      <Modal
        open={Boolean(selectedFut)}
        onClose={() => setSelectedFut(null)}
        title={selectedFut?.ref ?? "Detalle FUT"}
        body={
          selectedFut ? (
            <>
              <div className="row spread">
                <PersonCell name={selectedFut.studentName || "—"} detail={selectedFut.futDate} />
                <Pill tone={futStatusTone(selectedFut.status)}>{selectedFut.status}</Pill>
              </div>
              <p className="fine" style={{ marginTop: 14, whiteSpace: "pre-wrap" }}>
                {selectedFut.reason}
              </p>
            </>
          ) : null
        }
        footer={
          selectedFut && canResolve(selectedFut) ? (
            <div className="row right">
              <Btn
                variant="warn"
                icon="x"
                disabled={saving}
                onClick={() => {
                  void handleResolve(selectedFut.id, "Rechazada");
                }}
              >
                Rechazar
              </Btn>
              <Btn
                icon="check"
                disabled={saving}
                onClick={() => {
                  void handleResolve(selectedFut.id, "Aprobada");
                }}
              >
                Aprobar FUT
              </Btn>
            </div>
          ) : undefined
        }
      />

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Registrar solicitud FUT"
        body={
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="fut-student">Código SIAGIE (14 dígitos)</label>
              <input
                id="fut-student"
                type="text"
                inputMode="numeric"
                maxLength={14}
                pattern="\d{14}"
                placeholder="Ej. 12345678901234"
                value={formStudentId}
                onChange={(e) => setFormStudentId(e.target.value.replace(/\D/g, ""))}
              />
            </div>
            <div className="form-field">
              <label htmlFor="fut-date">Fecha de inasistencia</label>
              <input
                id="fut-date"
                type="date"
                value={formDate}
                onChange={(e) => setFormDate(e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="fut-ref">Número o referencia FUT</label>
              <input
                id="fut-ref"
                type="text"
                placeholder="Ej. FUT-004"
                value={formRef}
                onChange={(e) => setFormRef(e.target.value)}
              />
            </div>
            <div className="form-field wide">
              <label htmlFor="fut-reason">Motivo de la solicitud</label>
              <textarea
                id="fut-reason"
                rows={4}
                placeholder="Sustento de la justificación"
                value={formReason}
                onChange={(e) => setFormReason(e.target.value)}
              />
            </div>
          </div>
        }
        footer={
          <div className="row right">
            <Btn variant="secondary" onClick={() => setShowCreate(false)}>Cancelar</Btn>
            <Btn icon="check" disabled={saving} onClick={() => void handleCreate()}>
              Registrar FUT
            </Btn>
          </div>
        }
      />
    </>
  );
}
