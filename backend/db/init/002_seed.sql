-- 002_seed.sql
-- Datos ficticios para desarrollo y pruebas (basados en el prototipo SIGMA_21001_Prototipo.html)

-- Año lectivo 2026
INSERT INTO academic_years (id, starts_on, ends_on) VALUES
(2026, '2026-03-16', '2026-12-18');

-- Bimestres (periodos académicos)
INSERT INTO academic_terms (id, starts_on, ends_on, academic_year_id) VALUES
(1, '2026-03-16', '2026-05-15', 2026),
(2, '2026-05-25', '2026-07-24', 2026),
(3, '2026-08-10', '2026-10-09', 2026),
(4, '2026-10-19', '2026-12-18', 2026);

-- Secciones (primaria e inicial) — basadas en aulasBase del prototipo: ['3A','3B','6A','6B']
-- y secciones inicial: I3 Amarillo, I3 Verde, I4 Lila, I4 Rosado, I5 Celeste, I5 Rojo
INSERT INTO sections (id, academic_year_id, level, grade, label, shift, tutor) VALUES
('3A', 2026, 'Primaria', 3, 'A', 'Mañana', 'Daniela Torres'),
('3B', 2026, 'Primaria', 3, 'B', 'Mañana', NULL),
('6A', 2026, 'Primaria', 6, 'A', 'Tarde', NULL),
('6B', 2026, 'Primaria', 6, 'B', 'Tarde', NULL),
('I3A', 2026, 'Inicial', 3, 'Amarillo', 'Mañana', NULL),
('I3B', 2026, 'Inicial', 3, 'Verde', 'Tarde', NULL),
('I4A', 2026, 'Inicial', 4, 'Lila', 'Mañana', NULL),
('I4B', 2026, 'Inicial', 4, 'Rosado', 'Tarde', NULL),
('I5A', 2026, 'Inicial', 5, 'Celeste', 'Mañana', NULL),
('I5B', 2026, 'Inicial', 5, 'Rojo', 'Tarde', NULL);

-- Estudiantes (códigos SIAGIE de 14 dígitos, nombres y apellidos del prototipo)
INSERT INTO students (siagie_code, given_names, family_names, doc, active, qr) VALUES
('00000000012001', 'Valeria', 'Quispe Rojas', '70001001', true, 0),
('00000000012002', 'Mateo', 'Salas Vega', '70001002', true, 0),
('00000000012003', 'Luciana', 'Mendoza Paz', '70001003', true, 0),
('00000000012004', 'Thiago', 'Cruz León', '70001004', true, 0),
('00000000012005', 'Sofía', 'Flores Díaz', '70001005', true, 0),
('00000000012006', 'Gabriel', 'Ramos Luna', '70001006', true, 0),
('00000000012007', 'Camila', 'Vargas Solís', '70001007', true, 0),
('00000000012008', 'Álvaro', 'Núñez Arias', '70001008', true, 0),
('00000000012029', 'Renata', 'Salas Vega', '70001009', true, 0),
('00000000012030', 'Nicolás', 'Mendoza Paz', '70001010', true, 0),
('00000000012057', 'Paula', 'Cruz León', '70001011', true, 0),
('00000000012058', 'Diego', 'Flores Díaz', '70001012', true, 0),
('00000000012013', 'Abril', 'Quispe Rojas', '70001013', true, 0),
('00000000012014', 'Bruno', 'Salas Vega', '70001014', true, 0);

-- Matrículas activas para el año 2026
INSERT INTO enrollments (student_id, section_id, starts_on, status) VALUES
('00000000012001', '3A', '2026-03-16', 'active'),
('00000000012002', '3A', '2026-03-16', 'active'),
('00000000012003', '3A', '2026-03-16', 'active'),
('00000000012004', '3A', '2026-03-16', 'active'),
('00000000012005', '3A', '2026-03-16', 'active'),
('00000000012006', '3A', '2026-03-16', 'active'),
('00000000012007', '3A', '2026-03-16', 'active'),
('00000000012008', '3A', '2026-03-16', 'active'),
('00000000012029', '3B', '2026-03-16', 'active'),
('00000000012030', '3B', '2026-03-16', 'active'),
('00000000012057', '6A', '2026-03-16', 'active'),
('00000000012058', '6A', '2026-03-16', 'active'),
('00000000012013', '6B', '2026-03-16', 'active'),
('00000000012014', '6B', '2026-03-16', 'active');

-- Personal (del prototipo)
INSERT INTO personnel (id, name, role, shift, contact, doc, active, qr) VALUES
('P-001', 'Elena Salazar', 'Directora', 'Mañana', 'elena@ejemplo.test', '70002001', true, 0),
('P-002', 'Daniela Torres', 'Docente de aula', 'Mañana', 'daniela@ejemplo.test', '70002002', true, 0),
('P-003', 'Rafael Huamán', 'Docente de aula', 'Tarde', 'rafael@ejemplo.test', '70002003', true, 0),
('P-004', 'Irene Flores', 'Oficinista', 'Mañana', 'irene@ejemplo.test', '70002004', true, 0),
('P-005', 'Carolina Vega', 'Docente PIP', 'Tarde', 'carolina@ejemplo.test', '70002005', true, 0);

-- Usuarios del sistema (contraseña demo: Sigma2026, hasheada con bcrypt)
-- Hash generado con bcryptjs para la contraseña Sigma2026
INSERT INTO users (username, password_hash, full_name, role, active) VALUES
('direccion', '$2a$10$WZsL/I7Dawbmkt0N2SXdEOyyI3rVnCECmwVbei9Bzg8Sr2DYW1lkC', 'Elena Salazar', 'direccion', true),
('subdireccion', '$2a$10$WZsL/I7Dawbmkt0N2SXdEOyyI3rVnCECmwVbei9Bzg8Sr2DYW1lkC', 'Subdirectora Demo', 'subdireccion', true),
('pip', '$2a$10$WZsL/I7Dawbmkt0N2SXdEOyyI3rVnCECmwVbei9Bzg8Sr2DYW1lkC', 'Carolina Vega', 'pip', true),
('oficina', '$2a$10$WZsL/I7Dawbmkt0N2SXdEOyyI3rVnCECmwVbei9Bzg8Sr2DYW1lkC', 'Irene Flores', 'oficina', true),
('docente', '$2a$10$WZsL/I7Dawbmkt0N2SXdEOyyI3rVnCECmwVbei9Bzg8Sr2DYW1lkC', 'Daniela Torres', 'docente', true),
('auxiliar', '$2a$10$WZsL/I7Dawbmkt0N2SXdEOyyI3rVnCECmwVbei9Bzg8Sr2DYW1lkC', 'Auxiliar Demo', 'auxiliar', true),
('apoderado', '$2a$10$WZsL/I7Dawbmkt0N2SXdEOyyI3rVnCECmwVbei9Bzg8Sr2DYW1lkC', 'Apoderado Demo', 'apoderado', true);

-- Apoderados (vínculo con estudiantes, primeros 16 como en el prototipo)
INSERT INTO guardians (student_id, name, doc, phone, relation, email) VALUES
('00000000012001', 'Rosa Quispe', '77000101', '900100101', 'Madre', 'rosa@ejemplo.test'),
('00000000012002', 'María Salas', '77000102', '900100102', 'Madre', 'maria@ejemplo.test'),
('00000000012003', 'Hugo Mendoza', '77000103', '900100103', 'Padre', 'hugo@ejemplo.test'),
('00000000012004', 'José Cruz', '77000104', '900100104', 'Padre', 'jose@ejemplo.test'),
('00000000012005', 'Rosa Flores', '77000105', '900100105', 'Madre', NULL),
('00000000012006', 'María Ramos', '77000106', '900100106', 'Madre', NULL),
('00000000012007', 'Hugo Vargas', '77000107', '900100107', 'Padre', NULL),
('00000000012008', 'José Núñez', '77000108', '900100108', 'Padre', NULL);

-- Vincular la cuenta demo 'apoderado' con el apoderado de Valeria Quispe
UPDATE guardians
   SET user_id = (SELECT id FROM users WHERE username = 'apoderado')
 WHERE student_id = '00000000012001';

-- Jornadas de demostración (fechas del prototipo) con registros de asistencia
INSERT INTO attendance_sessions (section_id, school_date, status, opened_at, opened_by, closed_at, closed_by)
VALUES
 ('3A', '2026-11-09', 'closed', '2026-11-09 08:00:00Z', 'docente', '2026-11-09 09:00:00Z', 'docente'),
 ('3A', '2026-11-10', 'closed', '2026-11-10 08:00:00Z', 'docente', '2026-11-10 09:00:00Z', 'docente');

INSERT INTO student_attendance (session_id, student_id, status, source, recorded_at, recorded_by, client_event_id)
SELECT ats.id,
       a.student_id,
       a.status,
       'manual',
       ats.opened_at + (a.minutes || ' minutes')::interval,
       'docente',
       gen_random_uuid()
  FROM attendance_sessions ats
  JOIN (VALUES
    ('2026-11-09'::date, '00000000012001'::varchar(14), 'late'::text, 12),
    ('2026-11-09'::date, '00000000012002'::varchar(14), 'present'::text, 3),
    ('2026-11-09'::date, '00000000012003'::varchar(14), 'absent'::text, 0),
    ('2026-11-09'::date, '00000000012004'::varchar(14), 'present'::text, 5),
    ('2026-11-10'::date, '00000000012001'::varchar(14), 'present'::text, 2),
    ('2026-11-10'::date, '00000000012002'::varchar(14), 'present'::text, 4),
    ('2026-11-10'::date, '00000000012003'::varchar(14), 'absent'::text, 0),
    ('2026-11-10'::date, '00000000012004'::varchar(14), 'late'::text, 15),
    ('2026-11-10'::date, '00000000012005'::varchar(14), 'excused'::text, 0),
    ('2026-11-10'::date, '00000000012006'::varchar(14), 'present'::text, 6),
    ('2026-11-10'::date, '00000000012007'::varchar(14), 'absent'::text, 0),
    ('2026-11-10'::date, '00000000012008'::varchar(14), 'permit'::text, 0)
  ) AS a(school_date, student_id, status, minutes)
    ON a.school_date = ats.school_date
 WHERE ats.section_id = '3A';

-- Calendario escolar (días no lectivos)
INSERT INTO school_calendar (school_date, lective, reason) VALUES
('2026-11-01', false, 'Todos los Santos'),
('2026-12-08', false, 'Feriado nacional'),
('2026-12-09', false, 'Feriado nacional');

-- Configuración del sistema (parámetros del prototipo)
INSERT INTO system_config (key, value) VALUES
('window', 'rolling'),
('days', '7'),
('threshold', '3'),
('notify', 'review'),
('cutAM', '09:00'),
('cutPM', '14:00'),
('attendanceMode', 'staff-separate'),
('maxQueue', '200'),
('futDays', '7');
