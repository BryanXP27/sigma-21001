import type { PoolClient } from "pg";
import { logAudit } from "../../core/auth.js";

const demoStudents = [
  ["00000000012001", "Valeria", "Quispe Rojas", "70001001", "3A"],
  ["00000000012002", "Mateo", "Salas Vega", "70001002", "3A"],
  ["00000000012003", "Luciana", "Mendoza Paz", "70001003", "3A"],
  ["00000000012004", "Thiago", "Cruz León", "70001004", "3A"],
  ["00000000012005", "Sofía", "Flores Díaz", "70001005", "3A"],
  ["00000000012006", "Gabriel", "Ramos Luna", "70001006", "3A"],
  ["00000000012007", "Camila", "Vargas Solís", "70001007", "3A"],
  ["00000000012008", "Álvaro", "Núñez Arias", "70001008", "3A"],
  ["00000000012029", "Renata", "Salas Vega", "70001009", "3B"],
  ["00000000012030", "Nicolás", "Mendoza Paz", "70001010", "3B"],
  ["00000000012057", "Paula", "Cruz León", "70001011", "6A"],
  ["00000000012058", "Diego", "Flores Díaz", "70001012", "6A"],
  ["00000000012013", "Abril", "Quispe Rojas", "70001013", "6B"],
  ["00000000012014", "Bruno", "Salas Vega", "70001014", "6B"],
];

export async function restoreDemoSeed(
  client: PoolClient,
  byUser: string
): Promise<void> {
  await client.query(
    `INSERT INTO academic_years (id, starts_on, ends_on)
     VALUES (2026, '2026-03-16', '2026-12-18')
     ON CONFLICT (id) DO UPDATE
       SET starts_on = EXCLUDED.starts_on, ends_on = EXCLUDED.ends_on`
  );
  await client.query(
    `INSERT INTO academic_terms (id, starts_on, ends_on, academic_year_id)
     VALUES
       (1, '2026-03-16', '2026-05-15', 2026),
       (2, '2026-05-25', '2026-07-24', 2026),
       (3, '2026-08-10', '2026-10-09', 2026),
       (4, '2026-10-19', '2026-12-18', 2026)
     ON CONFLICT (id) DO UPDATE
       SET starts_on = EXCLUDED.starts_on,
           ends_on = EXCLUDED.ends_on,
           academic_year_id = EXCLUDED.academic_year_id`
  );

  const sections = [
    ["3A", "Primaria", 3, "A", "Mañana", "Daniela Torres"],
    ["3B", "Primaria", 3, "B", "Mañana", null],
    ["6A", "Primaria", 6, "A", "Tarde", null],
    ["6B", "Primaria", 6, "B", "Tarde", null],
    ["I3A", "Inicial", 3, "Amarillo", "Mañana", null],
    ["I3B", "Inicial", 3, "Verde", "Tarde", null],
    ["I4A", "Inicial", 4, "Lila", "Mañana", null],
    ["I4B", "Inicial", 4, "Rosado", "Tarde", null],
    ["I5A", "Inicial", 5, "Celeste", "Mañana", null],
    ["I5B", "Inicial", 5, "Rojo", "Tarde", null],
  ];
  for (const [id, level, grade, label, shift, tutor] of sections) {
    await client.query(
      `INSERT INTO sections (id, academic_year_id, level, grade, label, shift, tutor)
       VALUES ($1, 2026, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE
         SET academic_year_id = EXCLUDED.academic_year_id,
             level = EXCLUDED.level, grade = EXCLUDED.grade,
             label = EXCLUDED.label, shift = EXCLUDED.shift, tutor = EXCLUDED.tutor`,
      [id, level, grade, label, shift, tutor]
    );
  }

  for (const [code, names, surnames, doc, sectionId] of demoStudents) {
    await client.query(
      `INSERT INTO students (siagie_code, given_names, family_names, doc, active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (siagie_code) DO UPDATE
         SET given_names = EXCLUDED.given_names,
             family_names = EXCLUDED.family_names,
             doc = EXCLUDED.doc,
             active = true`,
      [code, names, surnames, doc]
    );
    const activeEnrollment = await client.query(
      `SELECT id FROM enrollments
        WHERE student_id = $1 AND status = 'active'
        ORDER BY starts_on DESC LIMIT 1 FOR UPDATE`,
      [code]
    );
    if ((activeEnrollment.rowCount ?? 0) > 0) {
      await client.query(
        `UPDATE enrollments
            SET section_id = $2, starts_on = '2026-03-16',
                ends_on = NULL, status = 'active'
          WHERE id = $1`,
        [activeEnrollment.rows[0].id, sectionId]
      );
    } else {
      await client.query(
        `INSERT INTO enrollments (student_id, section_id, starts_on, status)
         VALUES ($1, $2, '2026-03-16', 'active')`,
        [code, sectionId]
      );
    }
  }

  const passwordHash = "$2a$10$WZsL/I7Dawbmkt0N2SXdEOyyI3rVnCECmwVbei9Bzg8Sr2DYW1lkC";
  const demoUsers = [
    ["direccion", "Elena Salazar", "direccion"],
    ["subdireccion", "Subdirectora Demo", "subdireccion"],
    ["pip", "Carolina Vega", "pip"],
    ["oficina", "Irene Flores", "oficina"],
    ["docente", "Daniela Torres", "docente"],
    ["auxiliar", "Auxiliar Demo", "auxiliar"],
    ["apoderado", "Apoderado Demo", "apoderado"],
  ];
  for (const [username, fullName, role] of demoUsers) {
    await client.query(
      `INSERT INTO users (username, password_hash, full_name, role, active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (username) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             full_name = EXCLUDED.full_name,
             role = EXCLUDED.role,
             active = true,
             token_version = users.token_version + 1`,
      [username, passwordHash, fullName, role]
    );
  }

  const guardians = [
    ["00000000012001", "Rosa Quispe", "77000101", "900100101", "Madre", "rosa@ejemplo.test"],
    ["00000000012002", "María Salas", "77000102", "900100102", "Madre", "maria@ejemplo.test"],
    ["00000000012003", "Hugo Mendoza", "77000103", "900100103", "Padre", "hugo@ejemplo.test"],
    ["00000000012004", "José Cruz", "77000104", "900100104", "Padre", "jose@ejemplo.test"],
    ["00000000012005", "Rosa Flores", "77000105", "900100105", "Madre", null],
    ["00000000012006", "María Ramos", "77000106", "900100106", "Madre", null],
    ["00000000012007", "Hugo Vargas", "77000107", "900100107", "Padre", null],
    ["00000000012008", "José Núñez", "77000108", "900100108", "Padre", null],
  ];
  for (const [studentId, name, doc, phone, relation, email] of guardians) {
    await client.query(
      `INSERT INTO guardians (student_id, name, doc, phone, relation, email)
       SELECT $1, $2, $3, $4, $5, $6
        WHERE NOT EXISTS (
          SELECT 1 FROM guardians WHERE student_id = $1 AND doc = $3
        )`,
      [studentId, name, doc, phone, relation, email]
    );
    await client.query(
      `UPDATE guardians
          SET name = $2, phone = $4, relation = $5, email = $6
        WHERE student_id = $1 AND doc = $3`,
      [studentId, name, doc, phone, relation, email]
    );
  }
  await client.query(
    `UPDATE guardians
        SET user_id = (SELECT id FROM users WHERE username = 'apoderado')
      WHERE student_id = '00000000012001' AND doc = '77000101'`
  );

  const personnel = [
    ["P-001", "Elena Salazar", "Directora", "Mañana", "elena@ejemplo.test", "70002001"],
    ["P-002", "Daniela Torres", "Docente de aula", "Mañana", "daniela@ejemplo.test", "70002002"],
    ["P-003", "Rafael Huamán", "Docente de aula", "Tarde", "rafael@ejemplo.test", "70002003"],
    ["P-004", "Irene Flores", "Oficinista", "Mañana", "irene@ejemplo.test", "70002004"],
    ["P-005", "Carolina Vega", "Docente PIP", "Tarde", "carolina@ejemplo.test", "70002005"],
  ];
  for (const [id, name, role, shift, contact, doc] of personnel) {
    await client.query(
      `INSERT INTO personnel (id, name, role, shift, contact, doc, active)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, role = EXCLUDED.role,
             shift = EXCLUDED.shift, contact = EXCLUDED.contact,
             doc = EXCLUDED.doc, active = true`,
      [id, name, role, shift, contact, doc]
    );
  }

  await client.query(
    `INSERT INTO attendance_sessions
       (section_id, school_date, status, opened_at, opened_by, closed_at, closed_by)
     VALUES
       ('3A', '2026-11-09', 'closed', '2026-11-09 08:00:00Z', 'docente', '2026-11-09 09:00:00Z', 'docente'),
       ('3A', '2026-11-10', 'closed', '2026-11-10 08:00:00Z', 'docente', '2026-11-10 09:00:00Z', 'docente')
     ON CONFLICT (section_id, school_date) DO UPDATE
       SET status = 'closed',
           opened_at = EXCLUDED.opened_at,
           opened_by = EXCLUDED.opened_by,
           closed_at = EXCLUDED.closed_at,
           closed_by = EXCLUDED.closed_by`
  );
  await client.query(
    `INSERT INTO student_attendance
       (session_id, student_id, status, source, recorded_at, recorded_by, client_event_id)
     SELECT ats.id, sample.student_id, sample.status, 'manual',
            ats.opened_at + (sample.minutes || ' minutes')::interval,
            'docente', gen_random_uuid()
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
       ) AS sample(school_date, student_id, status, minutes)
         ON sample.school_date = ats.school_date
      WHERE ats.section_id = '3A'
     ON CONFLICT (session_id, student_id) DO UPDATE
       SET status = EXCLUDED.status,
           source = EXCLUDED.source,
           recorded_at = EXCLUDED.recorded_at,
           recorded_by = EXCLUDED.recorded_by`
  );
  await client.query(
    `INSERT INTO school_calendar (school_date, lective, reason) VALUES
       ('2026-11-01', false, 'Todos los Santos'),
       ('2026-12-08', false, 'Feriado nacional'),
       ('2026-12-09', false, 'Feriado nacional')
     ON CONFLICT (school_date) DO UPDATE
       SET lective = EXCLUDED.lective, reason = EXCLUDED.reason`
  );

  await logAudit(client, byUser, "Se restauraron los registros de demostración de SIGMA 21001.");
}
