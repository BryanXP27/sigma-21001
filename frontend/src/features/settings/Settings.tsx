import { useCallback, useEffect, useState } from "react";
import { api } from "../../api";
import { download } from "../../shared/files";
import { Btn, Card, Icon, Modal, Notice, PageHead, Table } from "../../shared/ui";
import type { AuthUser, Section } from "../../types";

interface SettingsProps {
  user: AuthUser;
}

export function Settings({ user }: SettingsProps) {
  const [config, setConfig] = useState<{ key: string; value: string }[]>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [sections, setSections] = useState<Section[]>([]);
  const [sectionEdits, setSectionEdits] = useState<
    Record<string, { shift: Section["shift"]; tutor: string }>
  >({});
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const canEdit = ["direccion", "subdireccion"].includes(user.role);
  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.config();
      setConfig(data);
      const initial: Record<string, string> = {};
      for (const c of data) initial[c.key] = c.value;
      setEdits(initial);
    } catch (err: any) {
      setError(err?.message ?? "No se pudo cargar la configuración.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSections = useCallback(async () => {
    try {
      const data = await api.sections();
      setSections(data);
      setSectionEdits(Object.fromEntries(
        data.map((section) => [
          section.id,
          { shift: section.shift, tutor: section.tutor ?? "" },
        ])
      ));
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudieron cargar las secciones.");
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    void loadSections();
  }, [loadConfig, loadSections]);

  const handleChange = (key: string, value: string) => {
    setEdits((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    const changes: Record<string, string> = {};
    for (const c of config) {
      const next = edits[c.key] ?? c.value;
      if (next !== c.value) changes[c.key] = next;
    }
    if (Object.keys(changes).length === 0) {
      setMessage("No hay cambios para guardar.");
      return;
    }
    setLoading(true);
    try {
      await api.saveConfig(changes);
      setMessage("Parámetros guardados.");
      await loadConfig();
    } catch (err: any) {
      setError(err?.message ?? "No se pudo guardar la configuración.");
    } finally {
      setLoading(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm(
      "Se volverán a cargar los registros semilla conocidos. Se sobrescribirán esos registros de demo; los datos adicionales y la configuración se conservarán. ¿Continuar?"
    )) return;
    setLoading(true);
    setError("");
    try {
      const result = await api.resetDemo();
      setMessage(result.message);
      await Promise.all([loadSections()]);
    } catch (err: any) {
      setError(err?.message ?? "No se pudieron restaurar los datos de demostración.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetConfig = async () => {
    if (!window.confirm("¿Restablecer únicamente los parámetros institucionales?")) return;
    setLoading(true);
    setError("");
    try {
      await api.resetConfig();
      setMessage("Parámetros restablecidos.");
      await loadConfig();
    } catch (err: any) {
      setError(err?.message ?? "No se pudo restablecer la configuración.");
    } finally {
      setLoading(false);
    }
  };

  const handleBackup = async () => {
    if (!window.confirm(
      "El respaldo incluye datos personales y hashes de contraseñas. Guárdalo de forma segura. ¿Descargar?"
    )) return;
    setLoading(true);
    setError("");
    try {
      const backup = await api.backup();
      const date = new Date().toISOString().slice(0, 10);
      download(
        `SIGMA-respaldo-${date}.json`,
        JSON.stringify(backup, null, 2),
        "application/json"
      );
      setMessage("Respaldo completo del servidor descargado. No incluye códigos OTP temporales.");
    } catch (err: any) {
      setError(err?.message ?? "No se pudo descargar el respaldo del servidor.");
    } finally {
      setLoading(false);
    }
  };

  const saveSections = async () => {
    setLoading(true);
    setError("");
    setMessage("");
    try {
      await api.updateSections(
        sections.map((section) => ({
          id: section.id,
          shift: sectionEdits[section.id]?.shift ?? section.shift,
          tutor: sectionEdits[section.id]?.tutor.trim() || null,
        }))
      );
      setMessage("Se guardaron los turnos y tutores.");
      setSectionsOpen(false);
      await loadSections();
    } catch (err: any) {
      setError(err?.message ?? "No se pudieron guardar las secciones.");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="empty">
        <Icon name="refresh-cw" size={22} />
        Cargando configuración…
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHead
        eyebrow="Administración"
        title="Configuración"
        detail="Revisa parámetros de la demostración y la organización por secciones."
      />

      <Notice>Los parámetros de esta sección pertenecen a la demostración y no modifican la operación institucional real.</Notice>

      {error && <Notice tone="warn">{error}</Notice>}
      {message && <Notice tone="good">{message}</Notice>}

      {!canEdit && (
        <Notice>
          <strong>Nota:</strong> Solo Dirección y Subdirección pueden modificar los parámetros institucionales.
        </Notice>
      )}

      <div className="stack">
        <Card
          title="Reglas de asistencia y alertas"
          detail="Parámetros de prueba"
          body={
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSave();
              }}
            >
              <div className="card pad">
                <div className="form-grid">
                  {config.map((c) => {
                    const key = c.key.toLowerCase();
                    const isTime = key.includes("cut");
                    const isNumber = ["days", "threshold", "fut", "max"].some((part) => key.includes(part));
                    const isWindow = key === "window";
                    const fieldId = `config-${c.key}`;
                    const value = edits[c.key] ?? c.value;
                    const onChange = (next: string) => handleChange(c.key, next);
                    return (
                      <div className="form-field" key={c.key}>
                        <label htmlFor={fieldId}>{c.key}</label>
                        {isWindow ? (
                          <select
                            id={fieldId}
                            value={value}
                            onChange={(e) => onChange(e.target.value)}
                            disabled={!canEdit}
                          >
                            <option value="rolling">Últimos días lectivos</option>
                            <option value="weekly">Semana de lunes a domingo</option>
                          </select>
                        ) : (
                          <input
                            id={fieldId}
                            type={isTime ? "time" : isNumber ? "number" : "text"}
                            min={isNumber ? 1 : undefined}
                            value={value}
                            onChange={(e) => onChange(e.target.value)}
                            disabled={!canEdit}
                          />
                        )}
                      </div>
                    );
                  })}
                  {canEdit && (
                    <div className="wide row">
                      <Btn type="submit" icon="check" disabled={loading}>
                        Guardar parámetros
                      </Btn>
                    </div>
                  )}
                </div>
              </div>
            </form>
          }
        />

        <Card
          title="Datos de la demostración"
          detail="Operaciones locales"
          body={
            <div className="card pad">
              <p className="fine">La nómina, los registros y las preferencias se almacenan en este servidor.</p>
              <div className="row">
                <Btn type="button" variant="secondary" icon="download" onClick={handleBackup} disabled={loading}>
                  Descargar respaldo
                </Btn>
                {user.role === "direccion" && (
                  <>
                    <Btn type="button" variant="secondary" icon="refresh-cw" onClick={handleResetConfig} disabled={loading}>
                      Restablecer parámetros
                    </Btn>
                    <Btn type="button" variant="warn" icon="refresh-cw" onClick={handleReset} disabled={loading}>
                      Restaurar datos demo
                    </Btn>
                  </>
                )}
              </div>
            </div>
          }
        />

        <Card
          title="Secciones y tutores"
          detail="Asignación separada de la nómina SIAGIE"
          more={
            canEdit ? (
              <Btn variant="secondary" slim onClick={() => setSectionsOpen(true)}>
                Editar secciones/tutores
              </Btn>
            ) : null
          }
          body={
            sections.length ? (
              <Table
                headers={["Sección", "Nivel", "Turno", "Tutor"]}
                rows={sections.map((section) => [
                  section.displayName,
                  section.level,
                  section.shift,
                  section.tutor || "—",
                ])}
                emptyText="No hay secciones registradas."
              />
            ) : (
              <p className="fine">
                No se pudo cargar la lista de secciones. La asignación de tutores se gestiona fuera de esta demostración.
              </p>
            )
          }
        />
      </div>

      <Modal
        open={sectionsOpen}
        onClose={() => setSectionsOpen(false)}
        title="Editar secciones/tutores"
        body={
          <div className="stack">
            <p className="fine">
              Los cambios se guardan en la base de datos. El historial de matrículas no se modifica al cambiar turno o tutor.
            </p>
            {sections.length ? (
              <div className="stack">
                {sections.map((section) => (
                    <div className="form-grid" key={section.id}>
                      <div className="form-field">
                        <label>{section.displayName} · turno</label>
                        <select
                          value={sectionEdits[section.id]?.shift ?? section.shift}
                          onChange={(event) => setSectionEdits((current) => ({
                            ...current,
                            [section.id]: {
                              shift: event.target.value as Section["shift"],
                              tutor: current[section.id]?.tutor ?? section.tutor ?? "",
                            },
                          }))}
                          disabled={!canEdit}
                        >
                          <option value="Mañana">Mañana</option>
                          <option value="Tarde">Tarde</option>
                        </select>
                      </div>
                      <div className="form-field">
                        <label htmlFor={`section-tutor-${section.id}`}>Docente tutor</label>
                        <input
                          id={`section-tutor-${section.id}`}
                          value={sectionEdits[section.id]?.tutor ?? section.tutor ?? ""}
                          onChange={(event) => setSectionEdits((current) => ({
                            ...current,
                            [section.id]: {
                              shift: current[section.id]?.shift ?? section.shift,
                              tutor: event.target.value,
                            },
                          }))}
                          disabled={!canEdit}
                        />
                      </div>
                    </div>
                ))}
              </div>
            ) : (
              <p className="fine">No hay secciones disponibles para mostrar.</p>
            )}
          </div>
        }
        footer={
          <div className="row right">
            <Btn variant="secondary" onClick={() => setSectionsOpen(false)}>
              Cerrar
            </Btn>
            {canEdit && (
              <Btn onClick={() => void saveSections()} disabled={loading}>
                Guardar cambios
              </Btn>
            )}
          </div>
        }
      />
    </div>
  );
}
