import { useState } from "react";
import { api } from "../api";
import { rowsFrom, workbook } from "./files";
import { Btn, Modal, Notice } from "./ui";

type ImportType = "students" | "guardians" | "staff";

interface ImportDialogProps {
  type: ImportType;
  sections: string[];
  onClose: () => void;
  onDone: (message: string) => void;
}

const definitions: Record<ImportType, { title: string; help: string; template: string[][] }> = {
  students: {
    title: "Importar nómina SIAGIE",
    help: "Usa la plantilla simplificada: codigo, nombres, apellidos, seccion, documento y matricula.",
    template: [
      ["codigo", "nombres", "apellidos", "seccion", "documento", "matricula"],
      ["00000000002001", "Alumna", "Ejemplo Rojas", "3A", "", "DEFINITIVA"],
    ],
  },
  guardians: {
    title: "Importar apoderados",
    help: "Incluye código del estudiante, nombre, DNI, celular, parentesco y correo.",
    template: [
      ["codigo", "nombre", "dni", "celular", "parentesco", "correo"],
      ["00000000012017", "Rosa Ejemplo", "70001555", "900009991", "Madre", "rosa@ejemplo.test"],
    ],
  },
  staff: {
    title: "Importar marcaciones del personal",
    help: "Incluye código del personal, fecha, ingreso y salida.",
    template: [
      ["codigo", "fecha", "ingreso", "salida"],
      ["P-003", "2026-11-10", "12:58:00", "18:00:00"],
    ],
  },
};

const normalize = (value: unknown) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

function toDate(value: unknown): string {
  const text = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text);
  if (match) return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  if (/^\d{4,5}(?:\.0+)?$/.test(text)) {
    return new Date(Date.UTC(1899, 11, 30) + Number(text) * 86400000)
      .toISOString()
      .slice(0, 10);
  }
  return "";
}

function toClock(value: unknown): string {
  const text = String(value ?? "").trim();
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(text)) {
    return text.length === 5 ? `${text}:00` : text;
  }
  if (/^0?\.\d+$/.test(text)) {
    const seconds = Math.round(Number(text) * 86400) % 86400;
    return new Date(seconds * 1000).toISOString().slice(11, 19);
  }
  return "";
}

export function ImportDialog({ type, sections, onClose, onDone }: ImportDialogProps) {
  const definition = definitions[type];
  const [pending, setPending] = useState<Array<Record<string, unknown>>>([]);
  const [issues, setIssues] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function review(file: File) {
    setMessage("");
    setIssues([]);
    setPending([]);
    try {
      const raw = await rowsFrom(file);
      if (!raw.length) throw new Error("El archivo está vacío.");
      const header = raw[0].map(normalize);
      const indexed: Record<string, number> = {};
      header.forEach((name, index) => {
        indexed[name] = index;
      });
      const needHeader = ["codigo", "nombre", "nombres", "fecha"].some((name) =>
        header.includes(name)
      );
      const start = needHeader ? 1 : 0;
      const value = (row: string[], key: string) =>
        String(row[indexed[key] ?? -1] ?? "").trim();
      const records: Array<Record<string, unknown>> = [];
      const problems: string[] = [];

      for (let index = start; index < raw.length; index += 1) {
        const row = raw[index];
        if (!row?.some(Boolean)) continue;
        const line = index + 1;
        if (type === "students") {
          const code = value(row, "codigo").padStart(14, "0");
          const names = value(row, "nombres");
          const surnames = value(row, "apellidos");
          const sectionId = value(row, "seccion");
          if (!/^\d{14}$/.test(code) || !names || !surnames || !sections.includes(sectionId)) {
            problems.push(`Fila ${line}: revisa código, nombres, apellidos y sección.`);
            continue;
          }
          records.push({
            siagie_code: code,
            given_names: names,
            family_names: surnames,
            doc: value(row, "documento") || undefined,
            section_id: sectionId,
            active: !/traslad|retir/.test(normalize(value(row, "matricula"))),
          });
        } else if (type === "guardians") {
          const code = value(row, "codigo").padStart(14, "0");
          const name = value(row, "nombre");
          const doc = value(row, "dni");
          const phone = value(row, "celular");
          const email = value(row, "correo");
          if (!/^\d{14}$/.test(code) || !name || !/^\d{8}$/.test(doc) || !/^9\d{8}$/.test(phone)) {
            problems.push(`Fila ${line}: revisa código, nombre, DNI y celular.`);
            continue;
          }
          if (email && !/^\S+@\S+\.\S+$/.test(email)) {
            problems.push(`Fila ${line}: correo electrónico inválido.`);
            continue;
          }
          records.push({
            student_id: code,
            name,
            doc,
            phone,
            relation: value(row, "parentesco") || undefined,
            email: email || undefined,
          });
        } else {
          const personnelId = value(row, "codigo");
          const date = toDate(value(row, "fecha"));
          const clock = toClock(value(row, "ingreso"));
          const out = toClock(value(row, "salida"));
          if (!personnelId || !date || !clock || (out && out < clock)) {
            problems.push(`Fila ${line}: revisa código, fecha y horarios.`);
            continue;
          }
          records.push({ personnel_id: personnelId, log_date: date, kind: "in", clock, source: "Importación" });
          if (out) {
            records.push({ personnel_id: personnelId, log_date: date, kind: "out", clock: out, source: "Importación" });
          }
        }
      }
      setPending(records);
      setIssues(problems.slice(0, 20));
      setMessage(`${records.length} registro(s) listos para importar.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo leer el archivo.");
    }
  }

  async function commit() {
    if (!pending.length) return;
    setBusy(true);
    let saved = 0;
    const failures: string[] = [];
    try {
      if (type === "students") {
        await api.importStudents(pending);
        saved = pending.length;
      } else {
        for (const record of pending) {
          try {
            if (type === "guardians") await api.createGuardian(record);
            else await api.markStaff(record);
            saved += 1;
          } catch (error) {
            failures.push(error instanceof Error ? error.message : "Registro rechazado.");
          }
        }
      }
      onDone(`Se importaron ${saved} registro(s).${failures.length ? ` ${failures.length} rechazados.` : ""}`);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      title={definition.title}
      onClose={onClose}
      body={
        <>
          <p className="fine" style={{ marginBottom: 14 }}>{definition.help}</p>
          <div className="row" style={{ marginBottom: 14 }}>
            <Btn
              variant="secondary"
              icon="download"
              slim
              onClick={() => void workbook(`SIGMA-plantilla-${type}.xlsx`, definition.template)}
            >
              Descargar plantilla
            </Btn>
          </div>
          <div className="form-field">
            <label htmlFor={`import-file-${type}`}>Archivo CSV o Excel</label>
            <input
              id={`import-file-${type}`}
              type="file"
              accept=".xlsx,.csv"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void review(file);
              }}
            />
          </div>
          {message && <Notice tone="good">{message}</Notice>}
          {issues.length > 0 && (
            <div className="notice warn" style={{ marginTop: 10 }}>
              <div>
                {issues.map((issue, index) => <div key={index}>{issue}</div>)}
              </div>
            </div>
          )}
        </>
      }
      footer={
        <>
          <Btn variant="secondary" onClick={onClose}>Cancelar</Btn>
          <Btn onClick={() => void commit()} disabled={!pending.length || busy}>
            Aplicar importación
          </Btn>
        </>
      }
    />
  );
}
