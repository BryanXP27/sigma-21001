import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { csvDownload } from "../../shared/files";
import { Btn, Card, Icon, Notice, PageHead, Summary, Table, Toolbar } from "../../shared/ui";
import type { AuditLog, AuthUser } from "../../types";

interface AuditProps {
  user: AuthUser;
}

export function Audit({ user }: AuditProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [limit] = useState(50);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const canExport = ["direccion", "subdireccion", "oficina"].includes(user.role);

  const loadAudit = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(offset),
      });
      if (search) params.set("search", search);
      const data = await api.audit(params.toString());
      setLogs(data.logs ?? []);
      setTotal(data.total ?? 0);
    } catch (err: any) {
      setError(err?.message ?? "No se pudo cargar la bitácora.");
    } finally {
      setLoading(false);
    }
  }, [limit, offset, search]);

  useEffect(() => {
    void loadAudit();
  }, [loadAudit]);

  const handleExportCsv = async () => {
    setError("");
    setMessage("");
    let exportLogs = logs;
    try {
      const params = new URLSearchParams({
        limit: String(Math.max(total, limit, 1)),
        offset: "0",
      });
      if (search) params.set("search", search);
      const data = await api.audit(params.toString());
      exportLogs = data.logs ?? [];
    } catch {
      // Sin conexión se usan los datos ya cargados, que reflejan la búsqueda actual.
      exportLogs = logs;
    }
    if (!exportLogs.length) {
      setError("No hay datos para exportar.");
      return;
    }
    csvDownload(`SIGMA-bitacora-${new Date().toISOString().slice(0, 10)}.csv`, [
      ["Fecha y hora", "Responsable", "Evento"],
      ...exportLogs.map((log) => [log.at, log.byUser, log.event]),
    ]);
    setMessage("Bitácora exportada a CSV.");
  };

  if (loading) {
    return (
      <div className="empty">
        <Icon name="refresh-cw" size={22} />
        Cargando bitácora…
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHead
        eyebrow="Administración"
        title="Bitácora"
        detail="Historial de cambios en los módulos de la plataforma."
        more={
          canExport && (
            <Btn variant="secondary" icon="download" onClick={() => void handleExportCsv()}>
              Descargar CSV
            </Btn>
          )
        }
      />

      {error && <Notice tone="warn">{error}</Notice>}
      {message && <Notice tone="good">{message}</Notice>}

      <Card
        title="Registro de actividad"
        detail="Fecha y hora de Perú"
        body={
          <>
            <Toolbar>
              <label className="search">
                Buscar evento o responsable
                <input
                  type="text"
                  placeholder="Buscar evento o responsable"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setOffset(0);
                  }}
                />
              </label>
            </Toolbar>
            <Table
              headers={["Fecha y hora", "Responsable", "Evento"]}
              rows={logs.map((log) => [log.at, log.byUser, log.event])}
              emptyText="No hay eventos en la bitácora."
            />
            <Summary>
              <div className="row spread">
                <span>
                  Mostrando {logs.length} de {total} eventos. Página {Math.floor(offset / limit) + 1}.
                </span>
                <div className="row">
                  <Btn
                    variant="secondary"
                    slim
                    icon="arrow-left"
                    onClick={() => setOffset(Math.max(0, offset - limit))}
                    disabled={offset === 0}
                  >
                    Anterior
                  </Btn>
                  <Btn
                    variant="secondary"
                    slim
                    icon="arrow-right"
                    onClick={() => setOffset(offset + limit)}
                    disabled={offset + limit >= total}
                  >
                    Siguiente
                  </Btn>
                </div>
              </div>
            </Summary>
          </>
        }
      />
    </div>
  );
}
