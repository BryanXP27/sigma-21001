import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../../api";
import { cacheAlerts, readAlerts } from "../../../offlineDb";
import { printReport, word } from "../../../shared/files";
import {
  Btn,
  Card,
  Metric,
  Modal,
  Notice,
  PageHead,
  PersonCell,
  Pill,
  Summary,
  Table,
  Toolbar,
} from "../../../shared/ui";
import type { Alert, AuthUser } from "../../../types";

interface AlertsProps {
  user: AuthUser;
}

const MANAGE_ROLES = ["direccion", "subdireccion", "pip", "oficina"];

function alertStatusTone(status: Alert["status"]): "orange" | "blue" | "green" {
  if (status === "Pendiente") return "orange";
  if (status === "Resuelta") return "green";
  return "blue";
}

function citationText(alert: Alert): string {
  const reason =
    alert.kind === "threshold"
      ? `${alert.count} inasistencias registradas en el periodo de seguimiento.`
      : "Inasistencia registrada durante la jornada.";
  return [
    "I.E.P. N.° 21001 · Zoilo Candela Sánchez",
    "Imperial, Cañete",
    "",
    "CITACIÓN DE DEMOSTRACIÓN",
    "",
    `Fecha: ${alert.alertDate}`,
    `Estudiante: ${alert.studentName || "—"}`,
    `Código SIAGIE: ${alert.studentId || "—"}`,
    `Motivo: ${reason}`,
    "",
    "Se solicita al apoderado coordinar con Dirección una reunión para revisar la asistencia del estudiante.",
    "",
    "Firma: _______________________",
  ].join("\n");
}

function messageText(alert: Alert): string {
  const name = alert.studentName || "el estudiante";
  return alert.kind === "threshold"
    ? `I.E.P. Zoilo Candela Sánchez informa que ${name} registra ${alert.count} inasistencias en el periodo de seguimiento. Por favor, comuníquese con Dirección.`
    : `I.E.P. Zoilo Candela Sánchez informa que ${name} registra una inasistencia el ${alert.alertDate}.`;
}

function citationMatrix(alert: Alert): unknown[][] {
  return [
    ["Campo", "Detalle"],
    ["Estudiante", alert.studentName || "—"],
    ["Código SIAGIE", alert.studentId || "—"],
    ["Fecha", alert.alertDate],
    ["Motivo", alert.kind === "threshold" ? `${alert.count} faltas` : "Inasistencia"],
    ["Estado", alert.status],
  ];
}

export function Alerts({ user }: AlertsProps) {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [filter, setFilter] = useState("Todos");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [citationAlert, setCitationAlert] = useState<Alert | null>(null);
  const [messageAlert, setMessageAlert] = useState<Alert | null>(null);

  const canManage = MANAGE_ROLES.includes(user.role);

  const loadAlerts = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.alerts();
      setAlerts(data);
      await cacheAlerts(data);
    } catch (err: any) {
      try {
        const cached = await readAlerts();
        setAlerts(cached);
        setError("Usando datos en caché (sin conexión).");
      } catch {
        setError("No se pudieron cargar las alertas.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAlerts();
  }, [loadAlerts]);

  const filtered = useMemo(() => {
    if (filter === "Todos") return alerts;
    return alerts.filter((a) => a.status === filter);
  }, [alerts, filter]);

  const pendingCount = alerts.filter((a) => a.status === "Pendiente").length;

  const updateStatus = async (id: string, newStatus: "Preparado" | "Resuelta") => {
    if (!canManage) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api.updateAlertStatus(id, newStatus);
      setMessage(
        newStatus === "Preparado"
          ? "Mensaje preparado. No se realizó un envío externo."
          : "Alerta resuelta."
      );
      setSelectedAlert(null);
      setMessageAlert(null);
      setCitationAlert(null);
      await loadAlerts();
    } catch (err: any) {
      setError(err?.message ?? "Error al actualizar la alerta.");
    } finally {
      setBusy(false);
    }
  };

  const simulateNotification = async (alert: Alert) => {
    if (!canManage) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await api.simulateAlertNotification(alert.id);
      setMessage(`${result.message} Destinatario(s): ${result.recipientCount}.`);
      setMessageAlert(null);
      await loadAlerts();
    } catch (err: any) {
      setError(err?.message ?? "No se pudo registrar la simulación de SMS.");
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (alert: Alert) => {
    setSelectedAlert(alert);
    setError("");
    try {
      const fresh = await api.alert(alert.id);
      setSelectedAlert((current) => (current?.id === alert.id ? fresh : current));
    } catch {
      // Se conserva la alerta ya cargada en la bandeja si falla la consulta.
    }
  };

  const printCitation = (alert: Alert) => {
    printReport(
      "Citación al apoderado",
      `Alerta ${alert.id} · ${alert.alertDate}`,
      ["Campo", "Detalle"],
      citationMatrix(alert).slice(1)
    );
  };

  const downloadCitation = async (alert: Alert) => {
    setError("");
    setMessage("");
    try {
      await word(
        `SIGMA-citacion-${alert.id}.docx`,
        "Citación al apoderado",
        citationText(alert).split("\n"),
        citationMatrix(alert)
      );
      setMessage("Citación descargada en Word.");
    } catch (err: any) {
      setError(err?.message ?? "No se pudo generar el documento Word.");
    }
  };

  if (loading) {
    return <div className="empty">Cargando alertas…</div>;
  }

  return (
    <>
      <PageHead
        eyebrow="Seguimiento"
        title="Alertas y citaciones"
        detail="Revisa las faltas y registra simulaciones de avisos a las familias."
      />

      {error && <Notice tone="warn">{error}</Notice>}
      {message && <Notice tone="good">{message}</Notice>}

      <div className="metrics">
        <Metric
          icon="bell-ring"
          title="Por revisar"
          value={pendingCount}
          note="Alertas pendientes"
          tone="orange"
        />
        <Metric
          icon="file-text"
          title="Por acumulación"
          value={alerts.filter((a) => a.kind === "threshold").length}
          note="Posibles citaciones"
          tone="red"
        />
        <Metric
          icon="send"
          title="Avisos preparados"
          value={alerts.filter((a) => a.status === "Preparado").length}
          note="Mensajes de demostración"
        />
        <Metric
          icon="check-check"
          title="Resueltas"
          value={alerts.filter((a) => a.status === "Resuelta").length}
          note="Con seguimiento"
          tone="green"
        />
      </div>

      <Card
        title="Bandeja de alertas"
        detail="Modo de pruebas SMS: no se envían mensajes externos."
        body={
          <>
            <Toolbar>
              <label>
                Estado
                <select value={filter} onChange={(e) => setFilter(e.target.value)}>
                  <option value="Todos">Todos los estados</option>
                  <option value="Pendiente">Pendiente</option>
                  <option value="Preparado">Preparado</option>
                  <option value="Resuelta">Resuelta</option>
                </select>
              </label>
            </Toolbar>
            <Table
              headers={["Estudiante", "Fecha", "Motivo", "Estado", "Acción"]}
              rows={filtered.map((a) => [
                <PersonCell name={a.studentName || "—"} />,
                a.alertDate,
                a.kind === "threshold" ? (
                  <Pill tone="red">{a.count} faltas</Pill>
                ) : (
                  <Pill tone="orange">Inasistencia</Pill>
                ),
                <Pill tone={alertStatusTone(a.status)}>{a.status}</Pill>,
                <div className="row">
                  {canManage && a.status === "Pendiente" && (
                    <Btn
                      variant="secondary"
                      slim
                      icon="send"
                      disabled={busy}
                      onClick={() => {
                        setError("");
                        setMessageAlert(a);
                      }}
                    >
                      Preparar mensaje
                    </Btn>
                  )}
                  {canManage && a.status !== "Resuelta" && (
                    <Btn slim icon="check" disabled={busy} onClick={() => void updateStatus(a.id, "Resuelta")}>
                      Resolver
                    </Btn>
                  )}
                  <Btn variant="secondary" slim icon="arrow-up-right" onClick={() => void openDetail(a)}>
                    Abrir
                  </Btn>
                </div>,
              ])}
              emptyText="No hay alertas para los filtros seleccionados."
            />
            <Summary>{filtered.length} alertas en la vista</Summary>
          </>
        }
      />

      <Modal
        open={Boolean(selectedAlert)}
        onClose={() => setSelectedAlert(null)}
        title="Detalle de alerta"
        body={
          selectedAlert ? (
            <>
              <div className="row spread">
                <PersonCell
                  name={selectedAlert.studentName || "—"}
                  detail={`${selectedAlert.alertDate} · SIAGIE ${selectedAlert.studentId || "—"}`}
                />
                <Pill tone={alertStatusTone(selectedAlert.status)}>{selectedAlert.status}</Pill>
              </div>
              <p className="fine" style={{ margin: "13px 0", whiteSpace: "pre-wrap" }}>
                {selectedAlert.kind === "threshold"
                  ? `${selectedAlert.count} faltas injustificadas según la regla de demostración.`
                  : "Inasistencia registrada durante la jornada."}
              </p>
            </>
          ) : null
        }
        footer={
          selectedAlert ? (
            <div className="row right">
              {canManage && selectedAlert.status === "Pendiente" && (
                <Btn
                  variant="secondary"
                  slim
                  icon="send"
                  disabled={busy}
                  onClick={() => {
                    setMessageAlert(selectedAlert);
                    setSelectedAlert(null);
                  }}
                >
                  Preparar mensaje
                </Btn>
              )}
              <Btn
                variant="secondary"
                slim
                icon="file-text"
                onClick={() => {
                  setCitationAlert(selectedAlert);
                  setSelectedAlert(null);
                }}
              >
                Ver citación
              </Btn>
              {canManage && selectedAlert.status !== "Resuelta" && (
                <Btn slim icon="check" disabled={busy} onClick={() => void updateStatus(selectedAlert.id, "Resuelta")}>
                  Resolver
                </Btn>
              )}
            </div>
          ) : undefined
        }
      />

      <Modal
        open={Boolean(messageAlert)}
        onClose={() => setMessageAlert(null)}
        title="Mensaje al apoderado"
        body={
          messageAlert ? (
            <>
              <Notice>Vista previa del aviso. En el modo de pruebas solo se registra una simulación; no se envía un SMS.</Notice>
              <textarea
                readOnly
                rows={5}
                aria-label="Vista previa del mensaje"
                style={{ marginTop: 10 }}
                value={messageText(messageAlert)}
              />
            </>
          ) : null
        }
        footer={
          messageAlert ? (
            <div className="row right">
              <Btn variant="secondary" onClick={() => setMessageAlert(null)}>Cancelar</Btn>
              <Btn icon="send" disabled={busy} onClick={() => void simulateNotification(messageAlert)}>
                Simular envío SMS
              </Btn>
            </div>
          ) : undefined
        }
      />

      <Modal
        open={Boolean(citationAlert)}
        onClose={() => setCitationAlert(null)}
        title="Citación al apoderado"
        body={
          citationAlert ? (
            <pre style={{ whiteSpace: "pre-wrap", font: "inherit", lineHeight: 1.55 }}>
              {citationText(citationAlert)}
            </pre>
          ) : null
        }
        footer={
          citationAlert ? (
            <div className="row right">
              <Btn variant="secondary" slim icon="printer" onClick={() => printCitation(citationAlert)}>
                Imprimir
              </Btn>
              <Btn variant="secondary" slim icon="download" onClick={() => printCitation(citationAlert)}>
                PDF
              </Btn>
              <Btn variant="secondary" slim icon="download" onClick={() => void downloadCitation(citationAlert)}>
                Word
              </Btn>
            </div>
          ) : undefined
        }
      />
    </>
  );
}
