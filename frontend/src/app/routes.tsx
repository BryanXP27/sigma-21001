export type RouteName =
  | "login"
  | "dashboard"
  | "asistencia"
  | "estudiantes"
  | "personal"
  | "apoderados"
  | "alertas"
  | "justificaciones"
  | "reportes"
  | "calendario"
  | "carnes"
  | "usuarios"
  | "bitacora"
  | "configuracion"
  | "familia";

export interface RouteDef {
  path: string;
  label: string;
  icon: string;
  roles: string[];
  component: string;
}

export const ROUTES: Record<RouteName, RouteDef> = {
  login: {
    path: "login",
    label: "Iniciar sesión",
    icon: "log-in",
    roles: ["direccion", "subdireccion", "pip", "oficina", "docente", "auxiliar", "apoderado"],
    component: "Login",
  },
  dashboard: {
    path: "dashboard",
    label: "Dashboard",
    icon: "layout-dashboard",
    roles: ["direccion", "subdireccion", "pip", "oficina", "docente", "auxiliar"],
    component: "Dashboard",
  },
  asistencia: {
    path: "asistencia",
    label: "Asistencia",
    icon: "scan-line",
    roles: ["direccion", "subdireccion", "pip", "oficina", "docente", "auxiliar"],
    component: "Attendance",
  },
  estudiantes: {
    path: "estudiantes",
    label: "Estudiantes",
    icon: "graduation-cap",
    roles: ["direccion", "subdireccion", "pip", "oficina", "docente", "auxiliar"],
    component: "Students",
  },
  personal: {
    path: "personal",
    label: "Personal",
    icon: "contact-round",
    roles: ["direccion", "subdireccion", "pip", "oficina"],
    component: "Personnel",
  },
  apoderados: {
    path: "apoderados",
    label: "Apoderados",
    icon: "users",
    roles: ["direccion", "subdireccion", "oficina"],
    component: "Guardians",
  },
  alertas: {
    path: "alertas",
    label: "Alertas y citaciones",
    icon: "bell-ring",
    roles: ["direccion", "subdireccion", "pip", "oficina", "docente", "auxiliar"],
    component: "Alerts",
  },
  justificaciones: {
    path: "justificaciones",
    label: "Justificaciones FUT",
    icon: "clipboard-check",
    roles: ["direccion", "subdireccion", "pip", "oficina", "docente", "auxiliar"],
    component: "Futs",
  },
  reportes: {
    path: "reportes",
    label: "Reportes",
    icon: "chart-no-axes-combined",
    roles: ["direccion", "subdireccion", "pip", "oficina"],
    component: "Reports",
  },
  calendario: {
    path: "calendario",
    label: "Calendario escolar",
    icon: "calendar-days",
    roles: ["direccion", "subdireccion", "pip", "oficina", "docente", "auxiliar"],
    component: "Calendar",
  },
  carnes: {
    path: "carnes",
    label: "Carnés QR",
    icon: "id-card",
    roles: ["direccion", "subdireccion", "pip", "oficina"],
    component: "Credentials",
  },
  usuarios: {
    path: "usuarios",
    label: "Usuarios y roles",
    icon: "shield-check",
    roles: ["direccion", "subdireccion", "pip", "oficina"],
    component: "Users",
  },
  bitacora: {
    path: "bitacora",
    label: "Bitácora",
    icon: "history",
    roles: ["direccion", "subdireccion", "oficina"],
    component: "Audit",
  },
  configuracion: {
    path: "configuracion",
    label: "Configuración",
    icon: "settings",
    roles: ["direccion", "subdireccion"],
    component: "Settings",
  },
  familia: {
    path: "familia",
    label: "Mi familia",
    icon: "users",
    roles: ["apoderado"],
    component: "Familia",
  },
};

export const NAV_GROUPS = [
  {
    group: "Operación escolar",
    items: ["dashboard", "asistencia", "estudiantes", "personal", "apoderados"],
  },
  {
    group: "Seguimiento",
    items: ["alertas", "justificaciones", "reportes"],
  },
  {
    group: "Administración",
    items: ["calendario", "carnes", "usuarios", "bitacora", "configuracion"],
  },
  {
    group: "Mi familia",
    items: ["familia"],
  },
];

export function getRoutesForRole(role: string): RouteDef[] {
  const allowed: string[] = {
    direccion: Object.keys(ROUTES),
    subdireccion: Object.keys(ROUTES).filter((r) => r !== "configuracion"),
    pip: ["dashboard", "asistencia", "estudiantes", "alertas", "justificaciones", "reportes", "calendario", "usuarios"],
    oficina: ["dashboard", "asistencia", "estudiantes", "personal", "apoderados", "alertas", "reportes", "calendario", "carnes", "usuarios", "bitacora"],
    docente: ["dashboard", "asistencia", "estudiantes", "alertas", "justificaciones", "reportes", "calendario"],
    auxiliar: ["dashboard", "asistencia", "estudiantes", "alertas", "justificaciones", "reportes", "calendario"],
    apoderado: ["familia"],
  }[role] ?? [];

  return NAV_GROUPS.flatMap((g) =>
    g.items.filter((id) => allowed.includes(id)).map((id) => ROUTES[id as RouteName])
  );
}
