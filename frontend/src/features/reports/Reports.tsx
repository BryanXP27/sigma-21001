import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { csvDownload, printReport, workbook, word } from "../../shared/files";
import { peruTodayIso } from "../../shared/time";
import {
  Btn,
  Card,
  Chart,
  Metric,
  Modal,
  Notice,
  PageHead,
  Summary,
  Table,
  Toolbar,
} from "../../shared/ui";
import type { AuthUser, ReportArchive } from "../../types";

interface ReportsProps {
  user: AuthUser;
}

type Period = "day" | "week" | "month" | "bimester" | "custom";
type ExportFormat = "Excel" | "Word" | "PDF" | "CSV";

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function periodRange(period: Exclude<Period, "custom">, todayIso: string): { from: string; to: string } {
  const [year, month, day] = todayIso.split("-").map(Number);
  const today = new Date(Date.UTC(year, month - 1, day));
  const start = new Date(today);
  if (period === "week") start.setUTCDate(start.getUTCDate() - 6);
  if (period === "month") start.setUTCDate(1);
  if (period === "bimester") start.setUTCMonth(Math.floor(start.getUTCMonth() / 2) * 2, 1);
  return { from: toIso(start), to: todayIso };
}

export function Reports({ user }: ReportsProps) {
  const [mode, setMode] = useState<"students" | "staff">("students");
  const [period, setPeriod] = useState<Period>("week");
  const [format, setFormat] = useState<ExportFormat>("Excel");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [section, setSection] = useState("");
  const [sections, setSections] = useState<Array<{ id: string; displayName: string }>>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [archives, setArchives] = useState<ReportArchive[]>([]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveDetail, setArchiveDetail] = useState<ReportArchive | null>(null);

  useEffect(() => {
    const range = periodRange("week", peruTodayIso());
    setFrom(range.from);
    setTo(range.to);
  }, []);

  const loadReport = useCallback(async () => {
    if (!from || !to) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ from, to, mode });
      if (section) params.set("section", section);
      const data = await api.reports(params.toString());
      setHeaders(data.headers);
      setColumns(data.columns ?? data.headers);
      setRows(data.rows);
    } catch (err: any) {
      setError(err?.message ?? "No se pudo generar el reporte.");
    } finally {
      setLoading(false);
    }
  }, [from, to, mode, section]);

  const loadArchives = useCallback(async () => {
    try {
      const data = await api.archives();
      setArchives(data);
    } catch {
      // Ignorar errores al cargar archivos
    }
  }, []);

  useEffect(() => {
    void loadArchives();
    (async () => {
      try {
        const data = await api.sections();
        setSections(data.map((s) => ({ id: s.id, displayName: s.displayName })));
      } catch {
        // El filtro de sección queda vacío si no hay conexión.
      }
    })();
  }, [loadArchives]);

  const handlePeriod = (value: Period) => {
    setPeriod(value);
    if (value === "custom") return;
    const range = periodRange(value, peruTodayIso());
    setFrom(range.from);
    setTo(range.to);
  };

  const handleGenerate = () => {
    void loadReport();
  };

  const handleArchive = async () => {
    if (!rows.length) {
      setError("El reporte no contiene registros para archivar.");
      return;
    }
    try {
      const title = `Consolidado ${mode === "students" ? "de estudiantes" : "del personal"} ${from} al ${to}`;
      await api.archiveReport({
        title,
        kind: mode,
        from_date: from,
        to_date: to,
        headers,
        rows,
      });
      setMessage("Reporte archivado.");
      void loadArchives();
    } catch (err: any) {
      setError(err?.message ?? "No se pudo archivar el reporte.");
    }
  };

  const matrix = () => [
    headers,
    ...rows.map((row) => columns.map((column) => row[column] ?? "")),
  ];

  const requireData = () => {
    if (!columns.length || !rows.length) {
      setError("No hay datos para exportar.");
      return false;
    }
    setError("");
    return true;
  };

  const handleExportCsv = () => {
    if (!requireData()) return;
    csvDownload(`SIGMA-reporte-${mode}-${to}.csv`, matrix());
    setMessage("Reporte exportado a CSV.");
  };

  const handleExportExcel = async () => {
    if (!requireData()) return;
    await workbook(`SIGMA-reporte-${to}.xlsx`, matrix());
    setMessage("Reporte exportado a Excel.");
  };

  const handleExportWord = async () => {
    if (!requireData()) return;
    const title = `Consolidado ${mode === "students" ? "de estudiantes" : "del personal"}`;
    await word(`SIGMA-reporte-${to}.docx`, title, [
      "SIGMA 21001 · Reporte de demostración",
      `${from} al ${to}`,
    ], matrix());
    setMessage("Reporte exportado a Word.");
  };

  const handlePrint = () => {
    if (!requireData()) return;
    printReport(
      `Consolidado ${mode === "students" ? "de estudiantes" : "del personal"}`,
      `SIGMA 21001 · ${from} al ${to}`,
      headers,
      matrix().slice(1)
    );
  };

  const handleExport = () => {
    if (format === "CSV") handleExportCsv();
    else if (format === "Excel") void handleExportExcel();
    else if (format === "Word") void handleExportWord();
    else handlePrint();
  };

  const tableHeaders = columns.map((column, index) => headers[index] ?? column);
  const reportDays = mode === "students" ? Number(rows[0]?.totalDays ?? 0) : 0;
  const missingCount = rows.reduce(
    (sum, row) => sum + Number(row.absent ?? row.noEntry ?? 0),
    0
  );

  const labelColumn = columns[0] ?? headers[0] ?? "Estudiante";
  const sectionColumn = columns.find((column) => /section|secci/i.test(column)) ?? (columns.length > 1 ? columns[1] : "");
  const absentColumn = columns.find((column) => /absent|faltas\s*injust|noentry|sin\s*ingreso/i.test(column));
  const lateColumn = columns.find((column) => /late|tard/i.test(column));

  const topRows = (column?: string) =>
    !rows.length || !column
      ? []
      : [...rows]
          .filter((row) => Number(row[column] ?? 0) > 0)
          .sort((a, b) => Number(b[column] ?? 0) - Number(a[column] ?? 0))
          .slice(0, 5)
          .map((row) => [
            String(row[labelColumn] ?? "—"),
            sectionColumn ? String(row[sectionColumn] ?? "—") : "—",
            String(row[column] ?? 0),
          ]);

  const topAbsences = topRows(absentColumn);
  const topLates = topRows(lateColumn);

  const dateColumn = columns.find((column) => /date|fecha/i.test(column));
  const trendValues: Array<{ present: number; late: number }> = [];
  const trendLabels: string[] = [];
  const presentColumn = columns.find((column) => /present|a\s*tiempo/i.test(column));
  const trendLateColumn = lateColumn ?? absentColumn;
  if (rows.length) {
    if (dateColumn) {
      const byDate = new Map<string, { present: number; late: number }>();
      for (const row of rows) {
        const key = String(row[dateColumn] ?? "").slice(0, 10);
        if (!key) continue;
        const current = byDate.get(key) ?? { present: 0, late: 0 };
        current.present += presentColumn ? Number(row[presentColumn] ?? 0) : 1;
        current.late += trendLateColumn ? Number(row[trendLateColumn] ?? 0) : 0;
        byDate.set(key, current);
      }
      for (const [key, value] of [...byDate.entries()].slice(-5)) {
        trendLabels.push(key.slice(5));
        trendValues.push(value);
      }
    } else if (presentColumn || trendLateColumn) {
      const slice = rows.slice(-5);
      slice.forEach((row, index) => {
        trendLabels.push(String(row[labelColumn] ?? `#${index + 1}`).slice(0, 8));
        trendValues.push({
          present: presentColumn ? Number(row[presentColumn] ?? 0) : 0,
          late: trendLateColumn ? Number(row[trendLateColumn] ?? 0) : 0,
        });
      });
    }
  }

  if (loading) {
    return <div className="empty">Generando reporte…</div>;
  }

  return (
    <>
      <PageHead
        eyebrow="Seguimiento"
        title="Reportes"
        detail="Consulta, descarga y archiva consolidados de asistencia."
        more={
          <div className="row">
            <Btn variant="secondary" icon="database" onClick={() => setArchiveOpen(true)}>
              Archivo
            </Btn>
            <Btn icon="download" onClick={handleExport}>
              Exportar
            </Btn>
          </div>
        }
      />

      {error && <Notice tone="warn">{error}</Notice>}
      {message && <Notice tone="good">{message}</Notice>}

      <div className="metrics">
        <Metric
          icon="clock"
          title="Días lectivos"
          value={reportDays}
          note="Intervalo seleccionado"
        />
        <Metric
          icon="users"
          title={mode === "staff" ? "Personal" : "Estudiantes"}
          value={rows.length}
          note="Incluidos en el reporte"
        />
        <Metric
          icon="circle-alert"
          title={mode === "staff" ? "Sin ingreso" : "Faltas injustificadas"}
          value={missingCount}
          note="Total del periodo"
          tone="orange"
        />
        <Metric
          icon="file-text"
          title="Tipo de informe"
          value="Demo"
          note="Formato interno preliminar"
        />
      </div>

      <div className="stack">
        <Card
          title="Consolidado de asistencia"
          detail={
            mode === "students"
              ? "Fórmula demo: a tiempo más tardanzas sobre días lectivos de matrícula."
              : "Las ausencias del personal se muestran como días sin ingreso."
          }
          body={
            <>
              <Toolbar>
                <label>
                  Población
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value as "students" | "staff")}
                  >
                    <option value="students">Estudiantes</option>
                    {user.role !== "apoderado" && <option value="staff">Personal</option>}
                  </select>
                </label>
                <label>
                  Periodo
                  <select value={period} onChange={(e) => handlePeriod(e.target.value as Period)}>
                    <option value="day">Diario</option>
                    <option value="week">Semanal</option>
                    <option value="month">Mensual</option>
                    <option value="bimester">Bimestral</option>
                    <option value="custom">Personalizado</option>
                  </select>
                </label>
                <label>
                  Desde
                  <input
                    type="date"
                    value={from}
                    onChange={(e) => {
                      setFrom(e.target.value);
                      setPeriod("custom");
                    }}
                  />
                </label>
                <label>
                  Hasta
                  <input
                    type="date"
                    value={to}
                    onChange={(e) => {
                      setTo(e.target.value);
                      setPeriod("custom");
                    }}
                  />
                </label>
                {mode === "students" && (
                  <label>
                    Sección
                    <select value={section} onChange={(e) => setSection(e.target.value)}>
                      <option value="">Todas</option>
                      {sections.map((s) => (
                        <option key={s.id} value={s.id}>{s.displayName}</option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  Formato
                  <select value={format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
                    <option value="Excel">Excel</option>
                    <option value="Word">Word</option>
                    <option value="PDF">PDF</option>
                    <option value="CSV">CSV</option>
                  </select>
                </label>
                <Btn variant="secondary" onClick={handleExport}>Exportar</Btn>
                <Btn onClick={handleGenerate}>Generar reporte</Btn>
              </Toolbar>

              {headers.length > 0 && (
                <>
                  <div className="toolbar spread">
                    <span className="muted fine">{rows.length} filas · {from} al {to}</span>
                    <div className="row">
                      <Btn variant="secondary" onClick={handleExportCsv}>Exportar CSV</Btn>
                      <Btn variant="secondary" onClick={() => void handleExportExcel()}>Excel</Btn>
                      <Btn variant="secondary" onClick={() => void handleExportWord()}>Word</Btn>
                      <Btn variant="secondary" onClick={handlePrint}>PDF / Imprimir</Btn>
                      <Btn variant="secondary" onClick={() => void handleArchive()}>
                        Archivar reporte
                      </Btn>
                    </div>
                  </div>
                  <Table
                    headers={tableHeaders}
                    rows={rows.map((row) => columns.map((column) => row[column] ?? "—"))}
                  />
                  <Summary>{rows.length} filas · {from} al {to}</Summary>
                </>
              )}
            </>
          }
        />

        {mode === "students" && (
          <>
            <div className="grid-two">
              <Card
                title="Más faltas injustificadas"
                detail="En el intervalo seleccionado"
                body={
                  <Table
                    headers={["Estudiante", "Sección", "Cantidad"]}
                    rows={topAbsences}
                    emptyText="Genera un reporte para ver las faltas."
                  />
                }
              />
              <Card
                title="Más tardanzas"
                detail="En el intervalo seleccionado"
                body={
                  <Table
                    headers={["Estudiante", "Sección", "Cantidad"]}
                    rows={topLates}
                    emptyText="Genera un reporte para ver las tardanzas."
                  />
                }
              />
            </div>
            <Card
              title="Tendencia del periodo"
              detail="Últimos cinco días lectivos seleccionados"
              body={
                trendValues.length ? (
                  <Chart values={trendValues} labels={trendLabels} />
                ) : (
                  <div className="empty">Selecciona un intervalo con datos para ver la tendencia.</div>
                )
              }
            />
          </>
        )}

      </div>

      <Modal
        open={archiveOpen}
        onClose={() => setArchiveOpen(false)}
        title="Archivo de reportes"
        body={
          <Table
            headers={["Reporte", "Periodo", "Acción"]}
            rows={archives.map((a) => [
              a.title,
              `${a.fromDate} – ${a.toDate}`,
              <Btn variant="secondary" slim onClick={() => { setArchiveDetail(a); setArchiveOpen(false); }}>
                Abrir
              </Btn>,
            ])}
            emptyText="Todavía no hay reportes archivados para este perfil."
          />
        }
      />

      <Modal
        open={Boolean(archiveDetail)}
        onClose={() => setArchiveDetail(null)}
        title={archiveDetail?.title ?? "Reporte archivado"}
        body={
          archiveDetail ? (
            <>
              <p className="muted fine" style={{ marginBottom: 10 }}>
                {archiveDetail.fromDate} – {archiveDetail.toDate} · {archiveDetail.generatedBy}
              </p>
              <Table
                headers={Array.isArray(archiveDetail.headers) ? archiveDetail.headers.map(String) : []}
                rows={
                  Array.isArray(archiveDetail.rows)
                    ? archiveDetail.rows.map((row) =>
                        Array.isArray(row) ? row.map((cell) => String(cell ?? "—")) : Object.values(row as Record<string, unknown>).map((cell) => String(cell ?? "—"))
                      )
                    : []
                }
                emptyText="Este reporte archivado no tiene filas."
              />
            </>
          ) : null
        }
      />
    </>
  );
}
