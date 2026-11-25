# SIGMA 21001

Aplicación funcional de asistencia escolar. El diseño de la interfaz React está alineado con `SIGMA_21001_Prototipo.html` (diseño aprobado por la I.E.P. Zoilo Candela Sánchez): mismos tokens CSS, componentes, iconografía Lucide, logo institucional y estructura de vistas. El prototipo se conserva como referencia original; la aplicación real está separada en `frontend/` y `backend/`.

## Requisitos

- Node.js 20 o posterior
- npm
- Docker Desktop con el motor de contenedores iniciado

## Inicio local

1. Copia `backend/.env.example` como `backend/.env` si deseas personalizar la conexión.
2. Inicia PostgreSQL y carga el esquema y datos ficticios:

   ```powershell
   docker compose up -d db
   ```

   PostgreSQL se publica en el puerto `5433` para evitar conflictos con instalaciones locales. Si necesitas otro puerto, establece `POSTGRES_HOST_PORT` antes de iniciar Compose y actualiza el puerto de `DATABASE_URL` en `backend/.env`.

3. Instala dependencias desde la raíz:

   ```powershell
   npm install
   ```

4. En una terminal, inicia la API:

   ```powershell
   npm run dev:api
   ```

5. En otra terminal, inicia la interfaz:

   ```powershell
   npm run dev:web
   ```

6. Abre <http://localhost:5173>.

La API estará disponible en <http://127.0.0.1:3002/api/health>. El puerto `3002` evita el conflicto con Grafana en `3001`. Para detener PostgreSQL:

```powershell
docker compose down
```

## Alcance actual

- Autenticación real con JWT y contraseñas cifradas con bcrypt. Roles: `direccion`, `subdireccion`, `pip`, `oficina`, `docente`, `auxiliar` y `apoderado`.
- Usuarios de demostración: los siete roles anteriores; contraseña para todos: `Sigma2026`.
- Registro de asistencia por lista manual o código QR (`SIGMA:E:<id>:<qr>`); la cámara usa `BarcodeDetector` cuando el navegador lo admite y permite ingresar el código manualmente.
- Estado sugerido por hora (`present`, `late`, `absent`) según el turno y los cortes configurables.
- Cierre de jornada transaccional: los estudiantes sin marcación quedan como faltantes y se generan alertas. Solo `direccion`, `subdireccion` y `pip` pueden reabrir la jornada o corregir registros; cada corrección conserva autor y motivo.
- Cola local en IndexedDB y sincronización idempotente al recuperar la conexión. `recorded_by` y `closed_by` identifican al usuario autenticado.
- Nómina de estudiantes y personal con importación validada desde CSV/XLSX; marcaciones de entrada y salida del personal.
- Alertas, justificaciones FUT con plazo de días lectivos, reportes exportables a CSV/XLSX/DOCX/PDF, calendario escolar, carnés QR, usuarios, bitácora y parámetros institucionales.
- Portal familiar real para `apoderado`, con el historial de los estudiantes vinculados a su cuenta.

La nómina y las credenciales de conexión de Docker son ficticias y exclusivas para desarrollo. El modo sin conexión requiere haber abierto la aplicación en línea al menos una vez para guardar la nómina de una sección. La API debe consultarse en <http://127.0.0.1:3002> para evitar resoluciones IPv6 alternativas.

## Verificación

```powershell
cd backend
npx tsc --noEmit
npx vitest run

cd ..\frontend
npx tsc --noEmit
npm run build
```

Con la API y PostgreSQL iniciados, también están disponibles los scripts de verificación end-to-end en la carpeta temporal de OpenCode (`smoke.ps1` y `advanced.ps1`). `advanced.ps1` valida reapertura, correcciones, permisos, marcación QR, importación y la identidad devuelta por `/me`.

El esquema actual de la base de datos y sus relaciones están documentados en `DIAGRAMA_BASE_DATOS_SIGMA.{mmd,svg,png}`. La migración `backend/migrate-corrections.ts` agregó las columnas `corrected_by` y `corrected_at` necesarias para las correcciones.
