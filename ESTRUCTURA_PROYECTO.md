# Estructura del proyecto SIGMA 21001

Este documento describe la estructura implementada de SIGMA 21001, aplicación de asistencia escolar para la I.E.P. Zoilo Candela Sánchez. La estructura está alineada con el prototipo aceptado por las autoridades (`SIGMA_21001_Prototipo.html`).

## Árbol del proyecto

```text
sigma-21001/
├── backend/
│   ├── src/
│   │   ├── api/                 # Rutas Express por módulo
│   │   │   ├── index.ts         # Router principal que monta todos los módulos
│   │   │   ├── auth.ts          # Login, logout, perfil, middleware de auth
│   │   │   ├── sections.ts
│   │   │   ├── students.ts
│   │   │   ├── attendance.ts    # Asistencia estudiantes (registro, cierre, sync)
│   │   │   ├── personnel.ts
│   │   │   ├── guardians.ts
│   │   │   ├── alerts.ts
│   │   │   ├── futs.ts
│   │   │   ├── reports.ts
│   │   │   ├── calendar.ts
│   │   │   ├── credentials.ts   # Carnés QR
│   │   │   ├── users.ts
│   │   │   ├── audit.ts
│   │   │   └── config.ts
│   │   ├── core/                # Configuración compartida
│   │   │   ├── db.ts            # Pool de pg
│   │   │   ├── auth.ts          # Hash de contraseñas, JWT, middleware de roles
│   │   │   ├── errors.ts        # Clase AppError
│   │   │   └── middleware.ts    # CORS, body parsing, logging
│   │   ├── modules/             # Lógica de negocio por dominio
│   │   │   ├── students/
│   │   │   ├── sections/
│   │   │   ├── personnel/
│   │   │   ├── guardians/
│   │   │   ├── student-attendance/
│   │   │   ├── staff-attendance/
│   │   │   ├── alerts/
│   │   │   ├── fut/
│   │   │   ├── reports/
│   │   │   ├── calendar/
│   │   │   ├── credentials/
│   │   │   ├── users/
│   │   │   └── audit/
│   │   ├── database/            # Migraciones y seeds
│   │   │   ├── migrations/
│   │   │   └── seeds/
│   │   ├── server.ts            # Punto de entrada Express
│   │   ├── types.ts             # Tipos compartidos backend
│   │   └── utils.ts
│   ├── db/
│   │   └── init/
│   │       ├── 001_schema.sql   # Esquema completo de base de datos
│   │       └── 002_seed.sql     # Datos ficticios para desarrollo
│   ├── .env.example
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── app/                 # Rutas, layout, menú por perfil
│   │   │   ├── routes.tsx
│   │   │   ├── layout.tsx
│   │   │   └── menu.tsx
│   │   ├── shared/              # Componentes, estilos, utilidades
│   │   │   ├── components/
│   │   │   ├── styles.css
│   │   │   └── utils.ts
│   │   ├── features/
│   │   │   ├── auth/            # Login, logout
│   │   │   ├── dashboard/       # Resumen con datos de otros módulos
│   │   │   ├── attendance/      # Asistencia: manual, QR, cierre, correcciones
│   │   │   ├── students/        # Nómina, fichas, matrícula
│   │   │   ├── personnel/       # Nómina y marcaciones del personal
│   │   │   ├── guardians/       # Directorio y vínculos
│   │   │   ├── follow-up/
│   │   │   │   ├── alerts/      # Alertas, citaciones, seguimiento
│   │   │   │   └── fut/         # Solicitudes de justificación
│   │   │   ├── reports/         # Consulta, descarga y archivo de reportes
│   │   │   ├── calendar/        # Días lectivos y periodos
│   │   │   ├── credentials/     # Carnés y códigos QR
│   │   │   ├── users/           # Cuentas y administración de perfiles
│   │   │   ├── audit/           # Consulta de bitácora
│   │   │   └── settings/        # Parámetros institucionales
│   │   ├── api.ts               # Cliente HTTP con auth
│   │   ├── offlineDb.ts         # IndexedDB (cola offline extendida)
│   │   ├── types.ts             # Tipos TypeScript compartidos
│   │   └── main.tsx
│   ├── index.html
│   ├── vite.config.ts
│   └── tsconfig.json
├── docker-compose.yml           # PostgreSQL 17 en puerto 5433
├── package.json                 # Workspaces (frontend, backend)
├── README.md                    # Instalación y ejecución
├── ESTRUCTURA_PROYECTO.md       # Este documento
├── DIAGRAMA_BASE_DATOS_SIGMA.{mmd,png,svg}
└── SIGMA_21001_Prototipo.html   # Prototipo original (referencia funcional y de diseño)
```

## Responsabilidad de cada parte

- **Frontend:** presenta la interfaz y recopila las acciones del usuario. Las carpetas de `features/` agrupan pantallas y componentes por funcionalidad. Incluye autenticación real, menú por rol y almacenamiento offline en IndexedDB.
- **Backend:** aplica las reglas del sistema, valida los datos, verifica permisos y expone la API. Backend modular con rutas por dominio y lógica de negocio separada en `modules/`.
- **Base de datos:** conserva la información compartida entre usuarios. El esquema en `backend/db/init/001_schema.sql` soporta todos los módulos del prototipo.
- **Autenticación:** usuarios con roles (`direccion`, `subdireccion`, `pip`, `oficina`, `docente`, `auxiliar`, `apoderado`) y permisos granulares validados en el backend.

## Flujo general

```
Usuario → Frontend → API del backend → autenticación y autorización
                                       → validación de reglas y permisos
                                       → base de datos
Usuario ← Frontend ← respuesta de la API
```

Los permisos deben validarse en el backend; ocultar opciones en la interfaz por sí solo no protege los datos.

## Módulos implementados (según el prototipo)

| Módulo | Funcionalidad |
|--------|--------------|
| `auth` | Login, logout, cambio de contraseña, perfiles de demo |
| `dashboard` | Resumen de asistencia, métricas del día, alertas por aula |
| `attendance` | Registro manual, escáner QR, cierre de jornada, correcciones |
| `students` | Nómina, fichas, matrícula, importación SIAGIE |
| `personnel` | Nómina docentes/admin, marcaciones entrada/salida |
| `guardians` | Directorio de apoderados, vínculos con estudiantes |
| `follow-up.alerts` | Alertas de inasistencia, citaciones, seguimiento |
| `follow-up.fut` | Solicitudes de justificación, aprobar/rechazar |
| `reports` | Consolidado de asistencia, exportar Excel/Word/PDF, archivar |
| `calendar` | Días lectivos/no lectivos, bimestres |
| `credentials` | Carnés QR para estudiantes y personal |
| `users` | Gestión de cuentas y roles |
| `audit` | Bitácora de cambios, exportar CSV |
| `settings` | Parámetros institucionales, respaldo/restablecer demo |
| `familia` | Portal apoderados (consulta solo de hijos vinculados) |

## Reglas de negocio clave

- Los registros de asistencia deben evitar duplicados por estudiante y fecha (`client_event_id` único + `UNIQUE(session_id, student_id)`).
- Las correcciones, cierres y aprobaciones deben conservar quién realizó la acción y cuándo (`recorded_by`, `closed_by`, `audit_log`).
- El cierre de jornada registra faltas automáticas para estudiantes sin marcación y genera alertas.
- Los permisos se validan en el backend por rol de usuario.
- La autenticación real reemplaza al `demoProfile` cosmético de la primera etapa.
