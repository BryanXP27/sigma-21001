import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { download, printReport, qrDataUrl, qrValue } from "../../shared/files";
import { Avatar, Btn, Card, Icon, Modal, Notice, PageHead, Summary, Table, Toolbar } from "../../shared/ui";
import type { AuthUser, Credential } from "../../types";

interface CredentialsProps {
  user: AuthUser;
}

export function Credentials({ user }: CredentialsProps) {
  const [type, setType] = useState<"students" | "staff">("students");
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selected, setSelected] = useState<Credential | null>(null);
  const [qrImage, setQrImage] = useState("");
  const [reissueTarget, setReissueTarget] = useState<Credential | null>(null);

  const loadCredentials = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.credentials(type);
      setCredentials(data);
    } catch (err: any) {
      setError(err?.message ?? "No se pudieron cargar los carnés.");
    } finally {
      setLoading(false);
    }
  }, [type]);

  useEffect(() => {
    void loadCredentials();
  }, [loadCredentials]);

  useEffect(() => {
    if (!selected) {
      setQrImage("");
      return;
    }
    let active = true;
    void qrDataUrl(
      qrValue(selected.id, type, selected.qr, selected.familyQrToken)
    )
      .then((image) => {
        if (active) setQrImage(image);
      })
      .catch(() => {
        if (active) setError("No se pudo generar el código QR.");
      });
    return () => {
      active = false;
    };
  }, [selected, type]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return credentials.filter((c) =>
      !needle ||
      c.name.toLowerCase().includes(needle) ||
      c.id.toLowerCase().includes(needle) ||
      (c.section && c.section.toLowerCase().includes(needle)) ||
      (c.role && c.role.toLowerCase().includes(needle))
    );
  }, [credentials, query]);

  const handleReissue = async (id: string) => {
    setLoading(true);
    try {
      const result = await api.reissueQr(type, id);
      setMessage(`Carné reemitido para ${result.name}. Nuevo código QR: ${result.qr}.`);
      setSelected((prev) =>
        prev && prev.id === id
          ? {
              ...prev,
              qr: Number(result.qr ?? prev.qr + 1),
              familyQrToken: result.familyQrToken ?? prev.familyQrToken,
            }
          : prev
      );
      void loadCredentials();
    } catch (err: any) {
      setError(err?.message ?? "No se pudo reemitir el carné.");
    } finally {
      setLoading(false);
    }
  };

  const confirmReissue = async () => {
    if (!reissueTarget) return;
    const id = reissueTarget.id;
    setReissueTarget(null);
    await handleReissue(id);
  };

  const downloadQr = (credential: Credential) => {
    if (!qrImage) return;
    download(`SIGMA-QR-${credential.id}.png`, qrImage, "image/png");
  };

  const savePdf = (credential: Credential) => {
    printReport(
      `Carné institucional · ${credential.name}`,
      `${type === "students" ? "Estudiante" : "Personal"} · ${credential.id} · ${credential.section ?? credential.role ?? "—"}`,
      ["Titular", "Código", "Grupo", "Código QR"],
      [
        [
          credential.name,
          credential.id,
          credential.section ?? credential.role ?? "—",
          qrValue(credential.id, type, credential.qr, credential.familyQrToken),
        ],
      ]
    );
  };

  const canReissue = ["direccion", "subdireccion", "pip", "oficina"].includes(user.role);

  if (loading && credentials.length === 0) {
    return (
      <div className="empty">
        <Icon name="refresh-cw" size={22} />
        Cargando carnés…
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHead
        eyebrow="Administración"
        title="Carnés QR"
        detail="Genera credenciales imprimibles para estudiantes y personal."
      />

      {error && <Notice tone="warn">{error}</Notice>}
      {message && <Notice tone="good">{message}</Notice>}

      <Card
        title="Credenciales institucionales"
        detail="Los QR de demostración se pueden probar en Asistencia."
        body={
          <>
            <Toolbar>
              <label>
                Tipo
                <select
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value as "students" | "staff");
                    setSelected(null);
                  }}
                >
                  <option value="students">Estudiantes</option>
                  <option value="staff">Personal</option>
                </select>
              </label>
              <label className="search">
                Buscador
                <input
                  type="text"
                  placeholder="Buscar por nombre o código"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            </Toolbar>
            <Table
              headers={["Titular", "Código", "Grupo", "Acción"]}
              rows={filtered.map((c) => [
                <div className="row" key={`name-${c.id}`}>
                  <Avatar name={c.name} />
                  <strong>{c.name}</strong>
                </div>,
                c.id,
                c.section ?? c.role ?? "—",
                <Btn
                  key={`action-${c.id}`}
                  variant="secondary"
                  slim
                  icon="qr-code"
                  onClick={() => setSelected(c)}
                >
                  Ver carné
                </Btn>,
              ])}
              emptyText="No hay carnés disponibles."
            />
            <Summary>
              {filtered.length} carnés disponibles de {credentials.length} totales.
              {!canReissue && " Solo Dirección, Subdirección, PIP y Oficina pueden reemitir carnés QR."}
            </Summary>
          </>
        }
      />

      <Modal
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="Carné institucional"
        body={
          selected ? (
            <div className="qr-paper">
              <div className="kicker">SIGMA 21001 · Carné demo</div>
              <h3>{selected.name}</h3>
              <p className="fine">
                {selected.section ?? selected.role ?? "—"} · {selected.id}
              </p>
              {qrImage ? (
                <img
                  src={qrImage}
                  alt={`Código QR de ${selected.name}`}
                  style={{ width: 155, height: 155 }}
                />
              ) : (
                <div className="scanning">Generando QR…</div>
              )}
              <p className="fine">
                <code>{qrValue(selected.id, type, selected.qr, selected.familyQrToken)}</code>
              </p>
              <p className="fine">«Guardar como PDF» abre la impresión del navegador para guardar el carné como PDF.</p>
            </div>
          ) : null
        }
        footer={
          selected ? (
            <div className="row right">
              <Btn variant="secondary" icon="download" onClick={() => downloadQr(selected)}>
                Descargar QR
              </Btn>
              <Btn variant="secondary" icon="printer" onClick={() => window.print()}>
                Imprimir
              </Btn>
              <Btn
                variant="secondary"
                icon="printer"
                title="Abre la impresión del navegador para guardar como PDF"
                onClick={() => savePdf(selected)}
              >
                Guardar como PDF
              </Btn>
              {selected.active && canReissue && (
                <Btn variant="warn" icon="refresh-cw" onClick={() => setReissueTarget(selected)}>
                  Reemitir
                </Btn>
              )}
            </div>
          ) : null
        }
      />

      <Modal
        open={Boolean(reissueTarget)}
        onClose={() => setReissueTarget(null)}
        title="Reemitir carné"
        body={
          <Notice tone="warn">
            Se generará un QR nuevo y el anterior quedará inválido para el registro en esta demo.
          </Notice>
        }
        footer={
          <div className="row right">
            <Btn variant="secondary" onClick={() => setReissueTarget(null)} disabled={loading}>
              Cancelar
            </Btn>
            <Btn variant="warn" icon="check" onClick={() => void confirmReissue()} disabled={loading}>
              Confirmar reemisión
            </Btn>
          </div>
        }
      />
    </div>
  );
}
