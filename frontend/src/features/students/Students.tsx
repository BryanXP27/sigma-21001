import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { cacheRoster, readAllStudents } from "../../offlineDb";
import { ImportDialog } from "../../shared/ImportDialog";
import { peruTodayIso } from "../../shared/time";
import {
  Btn,
  Card,
  FeedRow,
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

interface StudentsProps {
  user: AuthUser;
}

interface StudentForm {
  siagieCode: string;
  fullName: string;
  doc: string;
  sex: "" | "Hombre" | "Mujer";
  birth: string;
  sectionId: string;
  startsOn: string;
  active: boolean;
  endsOn: string;
}

interface StudentEditor {
  code: string | null;
  form: StudentForm;
}

function todayIso(): string {
  return peruTodayIso();
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function splitFullName(fullName: string): { givenNames: string; familyNames: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return { givenNames: fullName.trim(), familyNames: "" };
  if (parts.length === 2) return { givenNames: parts[0], familyNames: parts[1] };
  // Heurística simple: últimos 2 tokens como apellidos para nombres compuestos comunes.
  return { givenNames: parts.slice(0, -2).join(" "), familyNames: parts.slice(-2).join(" ") };
}

function validateStudentForm(form: StudentForm, editing: boolean): string {
  if (!editing && !/^\d{14}$/.test(form.siagieCode.trim())) {
    return "El código SIAGIE debe tener 14 dígitos.";
  }
  const { givenNames, familyNames } = splitFullName(form.fullName);
  if (!givenNames || !familyNames) return "Ingresa nombres y apellidos del estudiante.";
  if (form.birth && !isIsoDate(form.birth)) return "La fecha de nacimiento no es válida.";
  if (form.startsOn && !isIsoDate(form.startsOn)) {
    return "La fecha de habilitación no es válida.";
  }
  if (form.endsOn && !isIsoDate(form.endsOn)) {
    return "La fecha de retiro no es válida.";
  }
  return "";
}

export function Students({ user }: StudentsProps) {
  const [students, setStudents] = useState<Student[]>([]);
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const [showImport, setShowImport] = useState(false);
  const [studentEditor, setStudentEditor] = useState<StudentEditor | null>(null);
  const [fichaStudent, setFichaStudent] = useState<Student | null>(null);
  const [fichaGuardians, setFichaGuardians] = useState<Guardian[]>([]);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [sectionFilter, setSectionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "all">("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadStudents = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.students(
        sectionFilter || undefined,
        todayIso(),
        ["docente", "auxiliar"].includes(user.role) ? "active" : statusFilter
      );
      setStudents(data);
      await cacheRoster([], data);
    } catch (err: any) {
      try {
        const cached = await readAllStudents();
        setStudents(cached.filter((s) => !sectionFilter || s.sectionId === sectionFilter));
        setError("Usando datos en caché (sin conexión).");
      } catch {
        setError("No se pudieron cargar los estudiantes.");
      }
    } finally {
      setLoading(false);
    }
  }, [sectionFilter, statusFilter, user.role]);

  useEffect(() => {
    void loadStudents();
    void api.sections().then((items) => setSectionIds(items.map((item) => item.id))).catch(() => undefined);
  }, [loadStudents]);

  const filtered = useMemo(() => {
    return students.filter((s) => {
      const matchQuery = !query ||
        s.name.toLowerCase().includes(query.toLowerCase()) ||
        s.id.toLowerCase().includes(query.toLowerCase());
      const matchSection = !sectionFilter || s.sectionId === sectionFilter;
      const matchStatus = statusFilter === "all" ||
        (s.active ? "active" : "inactive") === statusFilter;
      return matchQuery && matchSection && matchStatus;
    });
  }, [students, query, sectionFilter, statusFilter]);

  const sections = useMemo(() => [...new Set(students.map((s) => s.sectionId))].sort(), [students]);
  const sectionOptions = useMemo(
    () => [...new Set([...sectionIds, ...students.map((item) => item.sectionId)].filter((id): id is string => Boolean(id)))].sort(),
    [sectionIds, students]
  );
  const formSectionOptions = studentEditor
    ? [...new Set([...sectionOptions, studentEditor.form.sectionId].filter((id): id is string => Boolean(id)))]
    : sectionOptions;
  const canManage = ["direccion", "subdireccion", "pip", "oficina"].includes(user.role);
  const canDelete = ["direccion", "subdireccion"].includes(user.role);
  const canImport = canManage;
  const canViewGuardians = ["direccion", "subdireccion", "oficina"].includes(user.role);

  function updateStudentField<K extends keyof StudentForm>(field: K, value: StudentForm[K]) {
    setStudentEditor((current) =>
      current ? { ...current, form: { ...current.form, [field]: value } } : current
    );
  }

  function openStudentForm(student?: Student) {
    setMessage("");
    setError("");
    setStudentEditor({
      code: student?.id ?? null,
      form: {
        siagieCode: student?.id ?? "",
        fullName: student ? [student.givenNames, student.familyNames].filter(Boolean).join(" ") || student.name : "",
        doc: student?.doc ?? "",
        sex: student?.sex === "Hombre" || student?.sex === "Mujer" ? student.sex : "",
        birth: student?.birth ?? "",
        sectionId: student?.sectionId || sectionFilter || sectionIds[0] || "3A",
        startsOn: student?.enrollmentStartsOn ?? todayIso(),
        active: student ? student.active : true,
        endsOn: student?.enrollmentEndsOn ?? "",
      },
    });
  }

  function openFicha(student: Student) {
    setMessage("");
    setError("");
    setFichaStudent(student);
    setFichaGuardians([]);
    void api.student(student.id)
      .then((fresh) => setFichaStudent((current) => current?.id === student.id ? fresh : current))
      .catch((err) => setError(err instanceof Error ? err.message : "No se pudo cargar la ficha."));
    if (canViewGuardians) {
      void api.guardians()
        .then((all) => setFichaGuardians(all.filter((g) => g.studentId === student.id)))
        .catch((err) => setError(err instanceof Error ? err.message : "No se pudieron cargar los apoderados."));
    }
  }

  async function saveStudent() {
    if (!studentEditor) return;
    const { code, form } = studentEditor;
    const problem = validateStudentForm(form, Boolean(code));
    if (problem) {
      setMessage("");
      setError(problem);
      return;
    }
    setMessage("");
    setError("");
    try {
      const { givenNames, familyNames } = splitFullName(form.fullName);
      const body: Record<string, unknown> = {
        given_names: givenNames,
        family_names: familyNames,
        doc: form.doc.trim() || undefined,
        sex: form.sex || undefined,
        birth: form.birth || undefined,
        active: form.active,
      };
      if (code) {
        const existingStudent = students.find((student) => student.id === code);
        if (form.sectionId && form.sectionId !== existingStudent?.sectionId) {
          body.section_id = form.sectionId;
          body.starts_on = form.startsOn;
        }
        if (!form.active && form.endsOn) body.ends_on = form.endsOn;
        await api.updateStudent(code, body);
        setMessage("Ficha de estudiante actualizada.");
      } else {
        await api.createStudent({
          ...body,
          siagie_code: form.siagieCode.trim(),
          section_id: form.sectionId || undefined,
          starts_on: form.startsOn || undefined,
        });
        setMessage("Estudiante creado correctamente.");
      }
      setStudentEditor(null);
      await loadStudents();
    } catch (err: any) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la ficha del estudiante.");
    }
  }

  async function deleteStudent(student: Student) {
    setMessage("");
    setError("");
    try {
      await api.deleteStudent(student.id);
      setMessage(`Se eliminó la ficha de ${student.name}.`);
      setFichaStudent((current) => current?.id === student.id ? null : current);
      await loadStudents();
    } catch (err: any) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el estudiante.");
    }
  }

  if (loading) {
    return (
      <div className="stack">
        <Notice>Cargando estudiantes…</Notice>
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHead
        eyebrow="Operación escolar"
        title="Estudiantes"
        detail="Nómina por código SIAGIE, nivel, sección y estado de matrícula."
        more={
          <div className="row">
            {canImport && (
              <Btn variant="secondary" icon="upload" onClick={() => setShowImport(true)}>
                Importar SIAGIE
              </Btn>
            )}
            {canManage && (
              <Btn icon="plus" onClick={() => openStudentForm()}>
                Nuevo estudiante
              </Btn>
            )}
          </div>
        }
      />

      {message && <Notice tone="good">{message}</Notice>}
      {error && <Notice tone="warn">{error}</Notice>}

      <Card
        title="Nómina estudiantil"
        detail="Datos ficticios para el piloto"
        body={
          <>
            <Toolbar>
              <label className="search">
                Nombre o código
                <input
                  type="text"
                  placeholder="Buscar estudiante"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <label>
                Sección
                <select
                  value={sectionFilter}
                  onChange={(e) => setSectionFilter(e.target.value)}
                >
                  <option value="">Todas las secciones</option>
                  {sections.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              {canManage && (
              <label>
                Matrícula
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === "active" || value === "inactive" || value === "all") {
                      setStatusFilter(value);
                    }
                  }}
                >
                  <option value="all">Todos</option>
                  <option value="active">Activa</option>
                  <option value="inactive">Trasladado o retirado</option>
                </select>
              </label>
              )}
            </Toolbar>
            <Table
              headers={["Estudiante", "Código SIAGIE", "Sección y turno", "Matrícula", "Acciones"]}
              rows={filtered.map((s) => [
                <PersonCell
                  key={`${s.id}-person`}
                  name={s.name}
                  detail={s.doc ? `DNI: ${s.doc}` : "Sin documento registrado"}
                />,
                s.id,
                s.sectionId,
                <Pill key={`${s.id}-status`} tone={s.active ? "green" : "orange"}>
                  {s.active ? "Activo" : "Retirado"}
                </Pill>,
                <div key={`${s.id}-actions`} className="row">
                  <Btn variant="secondary" slim icon="file-text" onClick={() => openFicha(s)}>
                    Ficha
                  </Btn>
                  {canManage && (
                    <Btn variant="ghost" slim onClick={() => openStudentForm(s)}>
                      Editar
                    </Btn>
                  )}
                  {canDelete && (
                    <Btn variant="warn" slim icon="x" onClick={() => void deleteStudent(s)}>
                      Eliminar
                    </Btn>
                  )}
                </div>,
              ])}
              emptyText="No hay estudiantes para los filtros seleccionados."
            />
            <Summary>
              {filtered.length} estudiantes en la vista de {students.length} totales.
            </Summary>
          </>
        }
      />

      {showImport && (
        <ImportDialog
          type="students"
          sections={sectionIds}
          onClose={() => setShowImport(false)}
          onDone={(text) => {
            setMessage(text);
            void loadStudents();
          }}
        />
      )}

      <Modal
        open={Boolean(studentEditor)}
        onClose={() => setStudentEditor(null)}
        title={studentEditor?.code ? "Editar estudiante" : "Nuevo estudiante"}
        body={studentEditor ? (
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="student-code">Código SIAGIE</label>
              <input
                id="student-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{14}"
                maxLength={14}
                placeholder="14 dígitos"
                value={studentEditor.form.siagieCode}
                onChange={(e) => updateStudentField("siagieCode", e.target.value)}
                disabled={Boolean(studentEditor.code)}
                required
              />
              {studentEditor.code && <span className="fine">El código no se puede modificar.</span>}
            </div>
            <div className="form-field">
              <label htmlFor="student-doc">Documento (opcional)</label>
              <input
                id="student-doc"
                type="text"
                maxLength={16}
                value={studentEditor.form.doc}
                onChange={(e) => updateStudentField("doc", e.target.value)}
              />
            </div>
            <div className="form-field wide">
              <label htmlFor="student-full-name">Nombres y apellidos</label>
              <input
                id="student-full-name"
                type="text"
                value={studentEditor.form.fullName}
                onChange={(e) => updateStudentField("fullName", e.target.value)}
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="student-section">Sección</label>
              <select
                id="student-section"
                value={studentEditor.form.sectionId}
                onChange={(e) => updateStudentField("sectionId", e.target.value)}
              >
                <option value="">Sin sección</option>
                {formSectionOptions.map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
              {studentEditor.code && <span className="fine">Los cambios de sección quedan registrados en el historial desde la fecha seleccionada.</span>}
            </div>
            <div className="form-field">
              <label htmlFor="student-start">Fecha de habilitación</label>
              <input
                id="student-start"
                type="date"
                value={studentEditor.form.startsOn}
                onChange={(e) => updateStudentField("startsOn", e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="student-sex">Sexo (opcional)</label>
              <select
                id="student-sex"
                value={studentEditor.form.sex}
                onChange={(e) => updateStudentField("sex", e.target.value as StudentForm["sex"])}
              >
                <option value="">Sin consignar</option>
                <option value="Hombre">Hombre</option>
                <option value="Mujer">Mujer</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="student-birth">Nacimiento (opcional)</label>
              <input
                id="student-birth"
                type="date"
                value={studentEditor.form.birth}
                onChange={(e) => updateStudentField("birth", e.target.value)}
              />
            </div>
            <div className="form-field">
              <label htmlFor="student-active">Estado de matrícula</label>
              <select
                id="student-active"
                value={studentEditor.form.active ? "active" : "inactive"}
                onChange={(e) => updateStudentField("active", e.target.value === "active")}
              >
                <option value="active">Activo</option>
                <option value="inactive">Retirado / trasladado</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="student-end">Fecha de retiro</label>
              <input
                id="student-end"
                type="date"
                value={studentEditor.form.endsOn}
                onChange={(e) => updateStudentField("endsOn", e.target.value)}
              />
            </div>
          </div>
        ) : null}
        footer={
          <div className="row right">
            <Btn variant="secondary" onClick={() => setStudentEditor(null)}>Cancelar</Btn>
            <Btn icon="check" onClick={() => void saveStudent()}>Guardar</Btn>
          </div>
        }
      />

      <Modal
        open={Boolean(fichaStudent)}
        onClose={() => setFichaStudent(null)}
        title="Ficha de estudiante"
        body={fichaStudent ? (
          <>
            <div className="row spread">
              <PersonCell
                name={fichaStudent.name}
                detail={fichaStudent.sectionId ? `Sección ${fichaStudent.sectionId}` : "Sin sección"}
              />
              <Pill tone={fichaStudent.active ? "green" : "orange"}>
                {fichaStudent.active ? "Activo" : "Retirado"}
              </Pill>
            </div>
            <p className="fine" style={{ margin: "12px 0" }}>
              Código SIAGIE: <b>{fichaStudent.id}</b><br />
              Nombres: {fichaStudent.givenNames || "—"} {fichaStudent.familyNames || ""}<br />
              Documento: {fichaStudent.doc || "No consignado"}<br />
              Sexo: {fichaStudent.sex || "Sin consignar"}<br />
              Nacimiento: {fichaStudent.birth || "Sin consignar"}<br />
              QR: {fichaStudent.qr || 0}
            </p>
            {canViewGuardians && (
              <Card
                title="Apoderados vinculados"
                body={fichaGuardians.length ? (
                  <div className="feed">
                    {fichaGuardians.map((guardian) => (
                      <FeedRow
                        key={guardian.id}
                        icon="users"
                        title={guardian.name}
                        detail={`${guardian.relation || "Sin parentesco"}${guardian.phone ? ` · ${guardian.phone}` : ""}`}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="empty">Sin apoderados registrados.</div>
                )}
              />
            )}
          </>
        ) : null}
        footer={fichaStudent && canManage ? (
          <div className="row right">
            <Btn
              variant="secondary"
              icon="file-text"
              onClick={() => {
                const selected = fichaStudent;
                setFichaStudent(null);
                openStudentForm(selected);
              }}
            >
              Editar ficha
            </Btn>
          </div>
        ) : undefined}
      />
    </div>
  );
}
