import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { cacheGuardians, readGuardians } from "../../offlineDb";
import { ImportDialog } from "../../shared/ImportDialog";
import { peruTodayIso } from "../../shared/time";
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
} from "../../shared/ui";
import type { Guardian, Student, AuthUser } from "../../types";

interface GuardiansProps {
  user: AuthUser;
}

interface GuardianForm {
  studentId: string;
  name: string;
  doc: string;
  phone: string;
  relation: string;
  email: string;
}

interface GuardianEditor {
  id: string | null;
  form: GuardianForm;
}

function todayIso(): string {
  return peruTodayIso();
}

function validateGuardianForm(form: GuardianForm, editing: boolean): string {
  if (!editing && !/^\d{14}$/.test(form.studentId.trim())) {
    return "El código SIAGIE del estudiante debe tener 14 dígitos.";
  }
  if (!form.name.trim()) return "Ingresa el nombre del apoderado.";
  if (!/^9\d{8}$/.test(form.phone.trim())) {
    return "El celular debe tener 9 dígitos y empezar con 9.";
  }
  if (!form.relation.trim()) return "Ingresa el parentesco.";
  if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    return "El correo electrónico no es válido.";
  }
  return "";
}

export function Guardians({ user }: GuardiansProps) {
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [guardianEditor, setGuardianEditor] = useState<GuardianEditor | null>(null);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const canManage = ["direccion", "subdireccion", "oficina"].includes(user.role);
  const canImport = canManage;

  const loadGuardians = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.guardians();
      setGuardians(data);
      await cacheGuardians(data);
    } catch (err: any) {
      try {
        const cached = await readGuardians();
        setGuardians(cached);
        setError("Usando datos en caché (sin conexión).");
      } catch {
        setError("No se pudieron cargar los apoderados.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGuardians();
  }, [loadGuardians]);

  useEffect(() => {
    if (!canManage) return;
    void api.students("", todayIso())
      .then(setStudents)
      .catch(() => setStudents([]));
  }, [canManage]);

  const filtered = useMemo(() => {
    return guardians.filter((g) => {
      const match = !query ||
        g.name.toLowerCase().includes(query.toLowerCase()) ||
        (g.studentName && g.studentName.toLowerCase().includes(query.toLowerCase())) ||
        (g.phone && g.phone.includes(query));
      return match;
    });
  }, [guardians, query]);

  function updateGuardianField<K extends keyof GuardianForm>(field: K, value: GuardianForm[K]) {
    setGuardianEditor((current) =>
      current ? { ...current, form: { ...current.form, [field]: value } } : current
    );
  }

  function openGuardianForm(guardian?: Guardian) {
    setMessage("");
    setError("");
    setGuardianEditor({
      id: guardian?.id ?? null,
      form: {
        studentId: guardian?.studentId ?? "",
        name: guardian?.name ?? "",
        doc: guardian?.doc ?? "",
        phone: guardian?.phone ?? "",
        relation: guardian?.relation ?? "",
        email: guardian?.email ?? "",
      },
    });
  }

  async function saveGuardian() {
    if (!guardianEditor) return;
    const { id, form } = guardianEditor;
    const problem = validateGuardianForm(form, Boolean(id));
    if (problem) {
      setMessage("");
      setError(problem);
      return;
    }
    setMessage("");
    setError("");
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      doc: form.doc.trim() || undefined,
      phone: form.phone.trim(),
      relation: form.relation.trim(),
      email: form.email.trim() || undefined,
    };
    try {
      if (id) {
        await api.updateGuardian(id, body);
        setMessage("Apoderado actualizado correctamente.");
      } else {
        await api.createGuardian({ ...body, student_id: form.studentId.trim() });
        setMessage("Apoderado registrado correctamente.");
      }
      setGuardianEditor(null);
      await loadGuardians();
    } catch (err: any) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el apoderado.");
    }
  }

  if (loading) {
    return (
      <div className="stack">
        <Notice>Cargando apoderados…</Notice>
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHead
        eyebrow="Operación escolar"
        title="Apoderados"
        detail="Contactos vinculados por código SIAGIE de estudiante."
        more={
          <div className="row">
            {canImport && (
              <Btn variant="secondary" icon="upload" onClick={() => setShowImport(true)}>
                Importar Excel
              </Btn>
            )}
            {canManage && (
              <Btn icon="plus" onClick={() => openGuardianForm()}>
                Nuevo apoderado
              </Btn>
            )}
          </div>
        }
      />

      {message && <Notice tone="good">{message}</Notice>}
      {error && <Notice tone="warn">{error}</Notice>}

      <Card
        title="Directorio de contactos"
        detail="Hasta dos apoderados por estudiante."
        body={
          <>
            <Toolbar>
              <label className="search">
                Apoderado, estudiante o celular
                <input
                  type="text"
                  placeholder="Buscar apoderado, estudiante o celular"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            </Toolbar>
            <Table
              headers={["Apoderado", "Estudiante", "Parentesco", "Celular", "Acciones"]}
              rows={filtered.map((g) => [
                <PersonCell
                  key={`${g.id}-person`}
                  name={g.name}
                  detail={g.doc ? `DNI: ${g.doc}` : undefined}
                />,
                g.studentName || g.studentId || "—",
                g.relation
                  ? <Pill key={`${g.id}-relation`} tone="blue">{g.relation}</Pill>
                  : <span key={`${g.id}-relation`} className="muted">—</span>,
                g.phone || "—",
                <div key={`${g.id}-actions`} className="row">
                  {canManage ? (
                    <Btn variant="secondary" slim onClick={() => openGuardianForm(g)}>
                      Editar
                    </Btn>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </div>,
              ])}
              emptyText="No hay apoderados registrados."
            />
            <Summary>
              {filtered.length} contactos en la vista de {guardians.length} totales.
            </Summary>
          </>
        }
      />

      {showImport && (
        <ImportDialog
          type="guardians"
          sections={[]}
          onClose={() => setShowImport(false)}
          onDone={(text) => {
            setMessage(text);
            void loadGuardians();
          }}
        />
      )}

      <Modal
        open={Boolean(guardianEditor)}
        onClose={() => setGuardianEditor(null)}
        title={guardianEditor?.id ? "Editar apoderado" : "Nuevo apoderado"}
        body={guardianEditor ? (
          <div className="form-grid">
            <div className="form-field wide">
              <label htmlFor="guardian-student">Código SIAGIE del estudiante</label>
              <input
                id="guardian-student"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{14}"
                maxLength={14}
                list="guardian-student-options"
                placeholder="14 dígitos"
                value={guardianEditor.form.studentId}
                onChange={(e) => updateGuardianField("studentId", e.target.value)}
                disabled={Boolean(guardianEditor.id)}
                required
              />
              <datalist id="guardian-student-options">
                {students.map((student) => (
                  <option key={student.id} value={student.id}>{student.name}</option>
                ))}
              </datalist>
              {guardianEditor.id && (
                <span className="fine">El estudiante no se puede cambiar desde esta ficha.</span>
              )}
              {!guardianEditor.id && students.some((s) => s.id === guardianEditor.form.studentId) && (
                <span className="fine">
                  {students.find((s) => s.id === guardianEditor.form.studentId)?.name}
                </span>
              )}
            </div>
            <div className="form-field wide">
              <label htmlFor="guardian-name">Nombre completo</label>
              <input
                id="guardian-name"
                type="text"
                value={guardianEditor.form.name}
                onChange={(e) => updateGuardianField("name", e.target.value)}
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="guardian-doc">DNI (opcional)</label>
              <input
                id="guardian-doc"
                type="text"
                inputMode="numeric"
                maxLength={16}
                value={guardianEditor.form.doc}
                onChange={(e) => updateGuardianField("doc", e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="guardian-phone">Celular</label>
              <input
                id="guardian-phone"
                type="tel"
                inputMode="tel"
                pattern="9[0-9]{8}"
                maxLength={9}
                placeholder="9xxxxxxxx"
                value={guardianEditor.form.phone}
                onChange={(e) => updateGuardianField("phone", e.target.value)}
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="guardian-relation">Parentesco</label>
              <input
                id="guardian-relation"
                type="text"
                value={guardianEditor.form.relation}
                onChange={(e) => updateGuardianField("relation", e.target.value)}
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="guardian-email">Correo (opcional)</label>
              <input
                id="guardian-email"
                type="email"
                value={guardianEditor.form.email}
                onChange={(e) => updateGuardianField("email", e.target.value)}
              />
            </div>
          </div>
        ) : null}
        footer={
          <div className="row right">
            <Btn variant="secondary" onClick={() => setGuardianEditor(null)}>Cancelar</Btn>
            <Btn icon="check" onClick={() => void saveGuardian()}>Guardar</Btn>
          </div>
        }
      />
    </div>
  );
}
