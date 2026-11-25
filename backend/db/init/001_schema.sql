-- 001_schema.sql
-- SIGMA 21001 - Esquema completo de base de datos
-- Soporta toda la funcionalidad del prototipo aceptado por la IEP Zoilo Candela Sánchez
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ============================================
-- AÑO LECTIVO
-- ============================================
CREATE TABLE academic_years (
    id integer PRIMARY KEY,
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    CHECK (starts_on <= ends_on)
);

-- ============================================
-- SECCIONES
-- ============================================
CREATE TABLE sections (
    id text PRIMARY KEY,                 -- ej: '3A', '6B', 'I3A'
    academic_year_id integer NOT NULL REFERENCES academic_years(id),
    level text NOT NULL CHECK (level IN ('Inicial', 'Primaria')),
    grade integer NOT NULL CHECK (grade BETWEEN 1 AND 6),
    label text NOT NULL,
    shift text NOT NULL CHECK (shift IN ('Mañana', 'Tarde')),
    tutor text,                          -- docente tutor asignado
    UNIQUE (academic_year_id, level, grade, label)
);

-- ============================================
-- ESTUDIANTES
-- ============================================
CREATE TABLE students (
    siagie_code varchar(14) PRIMARY KEY,
    given_names text NOT NULL,
    family_names text NOT NULL,
    doc varchar(16),                     -- DNI opcional
    sex text CHECK (sex IN ('Hombre', 'Mujer')),
    birth date,
    active boolean NOT NULL DEFAULT true,
    qr integer DEFAULT 0,                -- código de validación del carné QR
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- MATRÍCULAS
-- ============================================
CREATE TABLE enrollments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id varchar(14) NOT NULL REFERENCES students(siagie_code),
    section_id text NOT NULL REFERENCES sections(id),
    starts_on date NOT NULL,
    ends_on date,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn', 'transferred')),
    CHECK (ends_on IS NULL OR starts_on < ends_on)
);

CREATE INDEX enrollments_student_dates_idx ON enrollments (student_id, starts_on, ends_on);
CREATE INDEX enrollments_section_dates_idx ON enrollments (section_id, starts_on, ends_on);

ALTER TABLE enrollments
    ADD CONSTRAINT enrollments_no_active_overlap
    EXCLUDE USING gist (
        student_id WITH =,
        daterange(starts_on, COALESCE(ends_on, 'infinity'::date), '[)') WITH &&
    )
    WHERE (status = 'active');

-- ============================================
-- USUARIOS Y ROLES (AUTENTICACIÓN REAL)
-- ============================================
CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username text NOT NULL UNIQUE,     -- ej: 'direccion', 'docente'
    password_hash text NOT NULL,       -- bcrypt/argon2
    full_name text NOT NULL,
    role text NOT NULL CHECK (role IN (
        'direccion','subdireccion','pip','oficina','docente','auxiliar','apoderado'
    )),
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- PERSONAL (DOCENTES Y ADMINISTRATIVOS)
-- ============================================
CREATE TABLE personnel (
    id text PRIMARY KEY,               -- ej: 'P-001'
    name text NOT NULL,
    role text NOT NULL,                -- 'Directora', 'Docente de aula', etc.
    shift text NOT NULL CHECK (shift IN ('Mañana', 'Tarde')),
    contact text,                      -- email
    doc varchar(12),                   -- DNI opcional
    active boolean NOT NULL DEFAULT true,
    qr integer DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- APOLDERADOS
-- ============================================
CREATE TABLE guardians (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid REFERENCES users(id),  -- cuenta del portal familiar (opcional)
    student_id varchar(14) NOT NULL REFERENCES students(siagie_code),
    name text NOT NULL,
    doc varchar(8),                    -- DNI
    phone varchar(9),                  -- celular
    relation text,                     -- 'Madre', 'Padre', etc.
    email text,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Restricción: máximo 2 apoderados por estudiante (aplicada en aplicación)

-- ============================================
-- SESIONES DE ASISTENCIA (ESTUDIANTES)
-- ============================================
CREATE TABLE attendance_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    section_id text NOT NULL REFERENCES sections(id),
    school_date date NOT NULL,
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    opened_at timestamptz NOT NULL DEFAULT now(),
    opened_by text NOT NULL DEFAULT 'demo',
    closed_at timestamptz,
    closed_by text,
    UNIQUE (section_id, school_date),
    CHECK ((status = 'open' AND closed_at IS NULL) OR (status = 'closed' AND closed_at IS NOT NULL))
);

-- ============================================
-- ASISTENCIA DE ESTUDIANTES
-- ============================================
CREATE TABLE student_attendance (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id uuid NOT NULL REFERENCES attendance_sessions(id),
    student_id varchar(14) NOT NULL REFERENCES students(siagie_code),
    status text NOT NULL CHECK (status IN ('present', 'late', 'absent', 'excused', 'permit')),
    source text NOT NULL CHECK (source IN ('manual', 'qr', 'closure')),
    recorded_at timestamptz NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    recorded_by text NOT NULL DEFAULT 'demo',
    client_event_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
    reason text,                       -- motivo de corrección o FUT
    corrected_by text,                 -- autoridad que realizó la corrección
    corrected_at timestamptz,
    UNIQUE (session_id, student_id)
);

CREATE INDEX student_attendance_student_session_idx ON student_attendance (student_id, session_id);

-- ============================================
-- MARCACIONES DE PERSONAL
-- ============================================
CREATE TABLE staff_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    personnel_id text NOT NULL REFERENCES personnel(id),
    log_date date NOT NULL,
    in_time timestamptz,
    out_time timestamptz,
    source text NOT NULL DEFAULT 'manual',
    UNIQUE (personnel_id, log_date)
);

-- ============================================
-- ALERTAS
-- ============================================
CREATE TABLE alerts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id varchar(14) NOT NULL REFERENCES students(siagie_code),
    alert_date date NOT NULL,
    kind text NOT NULL CHECK (kind IN ('absence', 'threshold')),
    status text NOT NULL DEFAULT 'Pendiente' CHECK (status IN ('Pendiente', 'Preparado', 'Resuelta')),
    count integer DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- SOLICITUDES FUT (JUSTIFICACIONES)
-- ============================================
CREATE TABLE futs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id varchar(14) NOT NULL REFERENCES students(siagie_code),
    fut_date date NOT NULL,
    ref text NOT NULL,                 -- ej: 'FUT-001'
    reason text NOT NULL,
    status text NOT NULL DEFAULT 'Pendiente' CHECK (status IN ('Pendiente', 'Aprobada', 'Rechazada')),
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- CALENDARIO ESCOLAR
-- ============================================
CREATE TABLE school_calendar (
    school_date date PRIMARY KEY,
    lective boolean NOT NULL DEFAULT true,
    reason text
);

-- ============================================
-- PERIODOS ACADÉMICOS (BIMESTRES)
-- ============================================
CREATE TABLE academic_terms (
    id integer PRIMARY KEY,
    starts_on date NOT NULL,
    ends_on date NOT NULL,
    academic_year_id integer NOT NULL REFERENCES academic_years(id),
    CHECK (starts_on <= ends_on)
);

-- ============================================
-- CONFIGURACIÓN INSTITUCIONAL
-- ============================================
CREATE TABLE system_config (
    key text PRIMARY KEY,
    value text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- BITÁCORA DE AUDITORÍA
-- ============================================
CREATE TABLE audit_log (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    at timestamptz NOT NULL DEFAULT now(),
    by_user text NOT NULL,
    event text NOT NULL
);

-- ============================================
-- REPORTES ARCHIVADOS
-- ============================================
CREATE TABLE report_archives (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('students', 'staff')),
    from_date date NOT NULL,
    to_date date NOT NULL,
    generated_by text NOT NULL,
    role text NOT NULL,
    section_id text REFERENCES sections(id),
    headers jsonb NOT NULL,
    rows jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================
-- JORNADAS CERRADAS (tabla auxiliar para reapertura)
-- ============================================
CREATE TABLE closed_sessions (
    section_id text NOT NULL REFERENCES sections(id),
    school_date date NOT NULL,
    closed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (section_id, school_date)
);

-- ============================================
-- ÍNDICES ADICIONALES PARA RENDIMIENTO
-- ============================================
CREATE INDEX idx_student_attendance_date ON student_attendance(recorded_at);
CREATE INDEX idx_alerts_student_status ON alerts(student_id, status);
CREATE INDEX idx_futs_student_status ON futs(student_id, status);
CREATE INDEX idx_staff_logs_date ON staff_logs(log_date);
CREATE INDEX idx_audit_log_at ON audit_log(at);
