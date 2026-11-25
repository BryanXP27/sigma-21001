import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { Btn, Card, Icon, Modal, Notice, PageHead, Pill, Table } from "../../shared/ui";
import { peruMonthIso, peruTodayIso } from "../../shared/time";
import type { AcademicTerm, AuthUser, CalendarDay } from "../../types";

interface CalendarProps {
  user: AuthUser;
}

interface CalendarCell {
  date: string;
  day: number;
  lective: boolean;
  reason?: string;
  selected: boolean;
  isToday: boolean;
}

interface TermEdit {
  startsOn: string;
  endsOn: string;
}

const TERM_COUNT = 4;

function formatTermDate(value: string): string {
  if (!value) return "—";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("es-PE", { day: "2-digit", month: "short", year: "numeric" });
}

export function Calendar({ user }: CalendarProps) {
  const [month, setMonth] = useState(peruMonthIso);
  const [days, setDays] = useState<CalendarDay[]>([]);
  const [terms, setTerms] = useState<AcademicTerm[]>([]);
  const [selectedDate, setSelectedDate] = useState("");
  const [loading, setLoading] = useState(false);
  const [termsLoading, setTermsLoading] = useState(true);
  const [termsSaving, setTermsSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [formDate, setFormDate] = useState("");
  const [formLective, setFormLective] = useState(true);
  const [formReason, setFormReason] = useState("");
  const [termsOpen, setTermsOpen] = useState(false);
  const [termEdits, setTermEdits] = useState<TermEdit[]>([]);

  const [year, monthNum] = month.split("-").map(Number);

  const loadCalendar = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.calendar(`${year}`, `${String(monthNum).padStart(2, "0")}`);
      setDays(data);
    } catch (err: any) {
      setError(err?.message ?? "No se pudo cargar el calendario.");
    } finally {
      setLoading(false);
    }
  }, [year, monthNum]);

  const loadTerms = useCallback(async () => {
    setTermsLoading(true);
    try {
      const data = await api.terms();
      setTerms(data);
    } catch (err: any) {
      setError(err?.message ?? "No se pudieron cargar los bimestres.");
    } finally {
      setTermsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCalendar();
  }, [loadCalendar]);

  useEffect(() => {
    void loadTerms();
  }, [loadTerms]);

  const daysOfWeek = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

  const firstDayOfMonth = new Date(Date.UTC(year, monthNum - 1, 1));
  const lastDayOfMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
  const startOffset = firstDayOfMonth.getUTCDay() === 0 ? 6 : firstDayOfMonth.getUTCDay() - 1;

  const calendarCells = useMemo(() => {
    const cells: (CalendarCell | null)[] = [];
    for (let i = 0; i < startOffset; i++) cells.push(null);
    for (let d = 1; d <= lastDayOfMonth; d++) {
      const dateStr = `${year}-${String(monthNum).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const dayData = days.find((d) => d.schoolDate === dateStr);
      cells.push({
        date: dateStr,
        day: d,
        lective: dayData?.lective ?? !(new Date(Date.UTC(year, monthNum - 1, d)).getUTCDay() === 0 || new Date(Date.UTC(year, monthNum - 1, d)).getUTCDay() === 6),
        reason: dayData?.reason,
        selected: dateStr === selectedDate,
        isToday: dateStr === peruTodayIso(),
      });
    }
    return cells;
  }, [days, year, monthNum, selectedDate]);

  const handleDayClick = (dateStr: string) => {
    setSelectedDate(dateStr);
    setEditMode(false);
    setFormDate(dateStr);
    const dayData = days.find((d) => d.schoolDate === dateStr);
    if (dayData) {
      setFormLective(dayData.lective);
      setFormReason(dayData.reason ?? "");
    } else {
      setFormLective(true);
      setFormReason("");
    }
  };

  const handleSaveDay = async () => {
    if (!formDate) return;
    setLoading(true);
    try {
      await api.calendarDay(formDate, { lective: formLective, reason: formReason });
      setMessage("Día actualizado.");
      void loadCalendar();
      setEditMode(false);
    } catch (err: any) {
      setError(err?.message ?? "No se pudo actualizar el día.");
    } finally {
      setLoading(false);
    }
  };

  const openTermsModal = () => {
    setError("");
    setTermEdits(
      Array.from({ length: TERM_COUNT }, (_, index) => {
        const term = terms[index];
        return { startsOn: term?.startsOn ?? "", endsOn: term?.endsOn ?? "" };
      })
    );
    setTermsOpen(true);
  };

  const updateTermEdit = (index: number, field: keyof TermEdit, value: string) => {
    setTermEdits((prev) => prev.map((term, i) => (i === index ? { ...term, [field]: value } : term)));
  };

  const handleSaveTerms = async () => {
    const invalid = termEdits.some(
      (term, index) =>
        !term.startsOn ||
        !term.endsOn ||
        term.startsOn > term.endsOn ||
        (index > 0 && term.startsOn <= (termEdits[index - 1]?.endsOn ?? ""))
    );
    if (invalid) {
      setError("Verifica que los periodos estén en orden y no se superpongan.");
      return;
    }
    setTermsSaving(true);
    try {
      const yearId = terms[0]?.academicYearId || 2026;
      await api.updateTerms(
        yearId,
        termEdits.map((term) => ({ startsOn: term.startsOn, endsOn: term.endsOn }))
      );
      setMessage("Se actualizaron los cuatro bimestres.");
      setTermsOpen(false);
      await loadTerms();
    } catch (err: any) {
      setError(err?.message ?? "No se pudieron actualizar los bimestres.");
    } finally {
      setTermsSaving(false);
    }
  };

  const handlePrevMonth = () => {
    const d = new Date(Date.UTC(year, monthNum - 2, 1));
    setMonth(d.toISOString().slice(0, 7));
  };

  const handleNextMonth = () => {
    const d = new Date(Date.UTC(year, monthNum, 1));
    setMonth(d.toISOString().slice(0, 7));
  };

  const monthLabel = new Date(Date.UTC(year, monthNum - 1, 12)).toLocaleDateString("es-PE", { month: "long", year: "numeric" });

  const canEdit = ["direccion", "subdireccion", "pip", "oficina"].includes(user.role);
  const canEditTerms = ["direccion", "subdireccion"].includes(user.role);

  const selectedDay = days.find((d) => d.schoolDate === selectedDate);
  const selectedLective = selectedDay?.lective ?? formLective;
  const selectedReason = selectedDay?.reason || "Calendario base semanal.";

  if (loading || termsLoading) {
    return (
      <div className="empty">
        <Icon name="refresh-cw" size={22} />
        Cargando calendario…
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHead
        eyebrow="Administración"
        title="Calendario escolar"
        detail="Define días lectivos, feriados, suspensiones y periodos académicos."
      />

      {error && <Notice tone="warn">{error}</Notice>}
      {message && <Notice tone="good">{message}</Notice>}

      <div className="grid-two">
        <Card
          title={monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}
          detail="Selecciona un día para revisarlo."
          more={
            <div className="row">
              <Btn variant="secondary" slim icon="arrow-left" onClick={handlePrevMonth} aria-label="Mes anterior" />
              <Btn variant="secondary" slim icon="arrow-right" onClick={handleNextMonth} aria-label="Mes siguiente" />
            </div>
          }
          body={
            <div className="calendar-grid">
              {daysOfWeek.map((d) => (
                <span key={d}>{d}</span>
              ))}
              {calendarCells.map((cell, index) => {
                if (!cell) return <span key={`empty-${index}`} />;
                return (
                  <button
                    type="button"
                    key={cell.date}
                    className={`day${cell.lective ? "" : " off"}${cell.selected ? " selected" : ""}`}
                    aria-label={`${cell.date} · ${cell.lective ? "Lectivo" : "No lectivo"}${cell.isToday ? " · Hoy" : ""}`}
                    onClick={() => handleDayClick(cell.date)}
                  >
                    {cell.day}
                    {cell.reason && <small>{cell.reason}</small>}
                  </button>
                );
              })}
            </div>
          }
        />

        <div className="stack">
          <Card
            title="Detalle del día"
            detail={selectedDate || "Selecciona un día del calendario"}
            body={
              selectedDate ? (
                <div className="summary stack">
                  <div className="row spread">
                    <Pill tone={selectedLective ? "green" : "orange"}>
                      {selectedLective ? "Día lectivo" : "Día no lectivo"}
                    </Pill>
                    {canEdit && (
                      <Btn variant="secondary" icon="calendar-days" onClick={() => setEditMode(!editMode)}>
                        {editMode ? "Cancelar" : "Editar día"}
                      </Btn>
                    )}
                  </div>
                  <p className="fine">{selectedReason}</p>
                </div>
              ) : (
                <div className="empty">Selecciona un día para revisarlo.</div>
              )
            }
          />

          <Card
            title="Bimestres"
            detail="Cuatro periodos del año escolar"
            more={
              canEditTerms ? (
                <Btn variant="secondary" slim onClick={openTermsModal}>
                  Editar bimestres
                </Btn>
              ) : null
            }
            body={
              <div className="stack">
                <Table
                  headers={["Periodo", "Inicio", "Fin"]}
                  rows={terms.map((term, index) => [
                    `Bimestre ${index + 1}`,
                    formatTermDate(term.startsOn),
                    formatTermDate(term.endsOn),
                  ])}
                  emptyText="No hay bimestres registrados."
                />
                {!canEditTerms && (
                  <p className="fine">Solo Dirección y Subdirección pueden editar los bimestres.</p>
                )}
              </div>
            }
          />

          {!canEdit && (
            <Notice>
              <strong>Nota:</strong> Solo Dirección, Subdirección, PIP y Oficina pueden editar el calendario escolar.
            </Notice>
          )}
        </div>
      </div>

      <Modal
        open={editMode}
        onClose={() => setEditMode(false)}
        title={`Editar calendario · ${formDate}`}
        body={
          <div className="form-grid">
            <div className="form-field">
              <label htmlFor="calendar-lective">Tipo de día</label>
              <select
                id="calendar-lective"
                value={formLective ? "yes" : "no"}
                onChange={(e) => setFormLective(e.target.value === "yes")}
              >
                <option value="yes">Lectivo</option>
                <option value="no">No lectivo</option>
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="calendar-reason">Motivo</label>
              <input
                id="calendar-reason"
                type="text"
                value={formReason}
                onChange={(e) => setFormReason(e.target.value)}
                placeholder="Ej. suspensión de clases"
              />
            </div>
          </div>
        }
        footer={
          <div className="row right">
            <Btn variant="secondary" onClick={() => setEditMode(false)}>Cancelar</Btn>
            <Btn icon="check" onClick={handleSaveDay} disabled={loading}>Guardar</Btn>
          </div>
        }
      />

      <Modal
        open={termsOpen}
        onClose={() => setTermsOpen(false)}
        title="Editar bimestres"
        body={
          <div className="form-grid">
            {termEdits.flatMap((term, index) => [
              <div className="form-field" key={`term-start-${index}`}>
                <label htmlFor={`term-start-${index}`}>Bimestre {index + 1} · inicio</label>
                <input
                  id={`term-start-${index}`}
                  type="date"
                  value={term.startsOn}
                  onChange={(e) => updateTermEdit(index, "startsOn", e.target.value)}
                  required
                />
              </div>,
              <div className="form-field" key={`term-end-${index}`}>
                <label htmlFor={`term-end-${index}`}>Bimestre {index + 1} · fin</label>
                <input
                  id={`term-end-${index}`}
                  type="date"
                  value={term.endsOn}
                  onChange={(e) => updateTermEdit(index, "endsOn", e.target.value)}
                  required
                />
              </div>,
            ])}
          </div>
        }
        footer={
          <div className="row right">
            <Btn variant="secondary" onClick={() => setTermsOpen(false)} disabled={termsSaving}>
              Cancelar
            </Btn>
            <Btn icon="check" onClick={() => void handleSaveTerms()} disabled={termsSaving}>
              Guardar bimestres
            </Btn>
          </div>
        }
      />
    </div>
  );
}
