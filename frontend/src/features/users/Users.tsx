import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { Btn, Card, Icon, Modal, Notice, PageHead, PersonCell, Pill, Summary, Table, Toolbar } from "../../shared/ui";
import type { AuthUser } from "../../types";

interface UsersProps {
  user: AuthUser;
}

interface NewUserData {
  username: string;
  password: string;
  full_name: string;
  role: string;
  active: boolean;
  phone: string;
}

const emptyNewUser: NewUserData = {
  username: "",
  password: "",
  full_name: "",
  role: "docente",
  active: true,
  phone: "",
};

export function Users({ user }: UsersProps) {
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [roleFilter, setRoleFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newUser, setNewUser] = useState<NewUserData>(emptyNewUser);
  const [editData, setEditData] = useState<{
    full_name: string;
    role: string;
    active: boolean;
    password: string;
    phone: string;
  }>({
    full_name: "",
    role: "",
    active: true,
    password: "",
    phone: "",
  });

  const canManage = ["direccion", "subdireccion", "pip", "oficina"].includes(user.role);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.users();
      setUsers(data);
    } catch (err: any) {
      setError(err?.message ?? "No se pudieron cargar los usuarios.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const roles = ["direccion", "subdireccion", "pip", "oficina", "docente", "auxiliar", "apoderado"];

  const roleLabels: Record<string, string> = {
    direccion: "Dirección",
    subdireccion: "Subdirección",
    pip: "Docente PIP",
    oficina: "Oficina",
    docente: "Docente",
    auxiliar: "Auxiliar",
    apoderado: "Apoderado",
  };

  const filtered = useMemo(() => {
    return users.filter((u) => !roleFilter || u.role === roleFilter);
  }, [users, roleFilter]);

  const handleEdit = (u: AuthUser) => {
    setEditData({
      full_name: u.fullName,
      role: u.role,
      active: u.active,
      password: "",
      phone: u.phone ?? "",
    });
    setEditing(u.id);
  };

  const handleCancelEdit = () => {
    setEditing(null);
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setLoading(true);
    try {
      const updates: {
        full_name: string;
        role: string;
        active: boolean;
        phone: string | null;
        password?: string;
      } = {
        full_name: editData.full_name,
        role: editData.role,
        active: editData.active,
        phone: editData.phone || null,
      };
      if (editData.password) updates.password = editData.password;
      await api.updateUser(editing, updates);
      setMessage("Usuario actualizado.");
      setEditing(null);
      void loadUsers();
    } catch (err: any) {
      setError(err?.message ?? "No se pudo actualizar el usuario.");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("¿Estás seguro de eliminar este usuario?")) return;
    setLoading(true);
    try {
      await api.deleteUser(id);
      setMessage("Usuario eliminado.");
      void loadUsers();
    } catch (err: any) {
      setError(err?.message ?? "No se pudo eliminar el usuario.");
    } finally {
      setLoading(false);
    }
  };

  const openCreate = () => {
    setError("");
    setNewUser(emptyNewUser);
    setCreateOpen(true);
  };

  const handleCreate = async () => {
    const username = newUser.username.trim();
    const fullName = newUser.full_name.trim();
    if (!username || !fullName) {
      setError("Ingresa el usuario y el nombre completo.");
      return;
    }
    if (newUser.password.length < 6) {
      setError("La contraseña debe tener al menos 6 caracteres.");
      return;
    }
    setCreating(true);
    try {
      await api.createUser({
        username,
        password: newUser.password,
        full_name: fullName,
        role: newUser.role,
        active: newUser.active,
        phone: newUser.phone || undefined,
      });
      setMessage(`Cuenta creada para ${username}.`);
      setCreateOpen(false);
      setNewUser(emptyNewUser);
      void loadUsers();
    } catch (err: any) {
      setError(err?.message ?? "No se pudo crear la cuenta.");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="empty">
        <Icon name="refresh-cw" size={22} />
        Cargando usuarios…
      </div>
    );
  }

  return (
    <div className="stack">
      <PageHead
        eyebrow="Administración"
        title="Usuarios y roles"
        detail="Gestiona perfiles y revisa los permisos de demostración."
        more={
          canManage ? (
            <Btn icon="plus" onClick={openCreate}>
              Nueva cuenta
            </Btn>
          ) : null
        }
      />

      {error && <Notice tone="warn">{error}</Notice>}
      {message && <Notice tone="good">{message}</Notice>}

      {!canManage && (
        <Notice>
          <strong>Nota:</strong> Solo Dirección, Subdirección, PIP y Oficina pueden gestionar usuarios.
        </Notice>
      )}

      <div className="stack">
        <Card
          title="Cuentas del sistema"
          detail="Los perfiles demo se pueden activar y desactivar."
          body={
            <>
              <Toolbar>
                <label>
                  Rol
                  <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                  >
                    <option value="">Todos los roles</option>
                    {roles.map((r) => (
                      <option key={r} value={r}>{roleLabels[r]}</option>
                    ))}
                  </select>
                </label>
              </Toolbar>
              <Table
                headers={["Nombre", "Usuario", "Rol", "Celular verificado", "Estado", "Acciones"]}
                rows={filtered.map((u) => {
                  const isEditing = editing === u.id;
                  if (isEditing) {
                    return [
                      <input
                        key="name"
                        value={editData.full_name}
                        onChange={(e) => setEditData({ ...editData, full_name: e.target.value })}
                      />,
                      u.username,
                      <select
                        key="role"
                        value={editData.role}
                        onChange={(e) => setEditData({ ...editData, role: e.target.value })}
                      >
                        {roles.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}
                      </select>,
                      <input
                        key="phone"
                        type="tel"
                        inputMode="numeric"
                        maxLength={9}
                        value={editData.phone}
                        onChange={(e) => setEditData({
                          ...editData,
                          phone: e.target.value.replace(/\D/g, ""),
                        })}
                        placeholder="9 dígitos"
                      />,
                      <select
                        key="active"
                        value={editData.active ? "yes" : "no"}
                        onChange={(e) => setEditData({ ...editData, active: e.target.value === "yes" })}
                      >
                        <option value="yes">Activo</option>
                        <option value="no">Inactivo</option>
                      </select>,
                      <div className="row" key="actions">
                        <Btn slim icon="check" onClick={handleSaveEdit} disabled={loading}>Guardar</Btn>
                        <Btn slim variant="secondary" icon="x" onClick={handleCancelEdit}>Cancelar</Btn>
                      </div>,
                    ];
                  }
                  return [
                    <PersonCell key="name" name={u.fullName} />,
                    u.username,
                    roleLabels[u.role],
                    u.phone || "Sin registrar",
                    u.active ? <Pill tone="green">Activa</Pill> : <Pill tone="orange">Inactiva</Pill>,
                    canManage && u.username !== user.username ? (
                      <div className="row" key="actions">
                        <Btn slim variant="secondary" onClick={() => handleEdit(u)}>Editar</Btn>
                        <Btn slim variant="warn" onClick={() => handleDelete(u.id)}>Eliminar</Btn>
                      </div>
                    ) : (
                      <span className="muted" key="actions">—</span>
                    ),
                  ];
                })}
                emptyText="No hay usuarios registrados."
              />
              <Summary>{filtered.length} usuarios de {users.length} totales.</Summary>
            </>
          }
        />

        <Card
          title="Matriz de acceso"
          detail="Configuración de demostración pendiente de validación institucional."
          body={
            <Table
              headers={["Rol", "Visibilidad", "Aprueba FUT", "Gestiona cuentas"]}
              rows={roles.map((r) => [
                roleLabels[r],
                r === "apoderado"
                  ? "Solo asistencia vinculada"
                  : r === "docente" || r === "auxiliar"
                    ? "Aula asignada"
                    : "Vista institucional",
                ["direccion", "subdireccion"].includes(r) ? "Sí" : "—",
                ["direccion", "subdireccion", "pip", "oficina"].includes(r) ? "Sí" : "—",
              ])}
            />
          }
        />
      </div>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Nueva cuenta"
        body={
          <form
            id="sigma-new-user"
            className="form-grid"
            onSubmit={(e) => {
              e.preventDefault();
              void handleCreate();
            }}
          >
            <div className="form-field">
              <label htmlFor="new-user-username">Usuario</label>
              <input
                id="new-user-username"
                type="text"
                value={newUser.username}
                onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                autoComplete="username"
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="new-user-password">Contraseña</label>
              <input
                id="new-user-password"
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                autoComplete="new-password"
                minLength={6}
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="new-user-name">Nombre completo</label>
              <input
                id="new-user-name"
                type="text"
                value={newUser.full_name}
                onChange={(e) => setNewUser({ ...newUser, full_name: e.target.value })}
                required
              />
            </div>
            <div className="form-field">
              <label htmlFor="new-user-role">Rol</label>
              <select
                id="new-user-role"
                value={newUser.role}
                onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
              >
                {roles.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}
              </select>
            </div>
            <div className="form-field">
              <label htmlFor="new-user-phone">Celular para recuperar acceso</label>
              <input
                id="new-user-phone"
                type="tel"
                inputMode="numeric"
                maxLength={9}
                value={newUser.phone}
                onChange={(e) => setNewUser({
                  ...newUser,
                  phone: e.target.value.replace(/\D/g, ""),
                })}
                placeholder="9 dígitos, opcional"
              />
            </div>
            <div className="form-field">
              <label htmlFor="new-user-active">Estado</label>
              <select
                id="new-user-active"
                value={newUser.active ? "yes" : "no"}
                onChange={(e) => setNewUser({ ...newUser, active: e.target.value === "yes" })}
              >
                <option value="yes">Activa</option>
                <option value="no">Inactiva</option>
              </select>
            </div>
            <p className="fine wide">La contraseña debe tener al menos 6 caracteres. Las cuentas agregadas permiten probar la gestión de usuarios.</p>
          </form>
        }
        footer={
          <div className="row right">
            <Btn variant="secondary" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancelar
            </Btn>
            <Btn type="submit" form="sigma-new-user" icon="check" disabled={creating}>
              Crear cuenta
            </Btn>
          </div>
        }
      />
    </div>
  );
}
