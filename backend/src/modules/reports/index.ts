import { PoolClient } from "pg";
import { pool } from "../../core/db.js";
import { logAudit } from "../../core/auth.js";
import { NotFoundError, ValidationError } from "../../core/errors.js";

export interface ReportRow {
  name: string;
  section: string;
  totalDays: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  permit: number;
  none: number;
  attendancePct: string;
}

export interface StaffReportRow {
  name: string;
  role: string;
  shift: string;
  entries: number;
  lates: number;
  noEntry: number;
  exits: number;
}

export interface ReportArchiveRow {
  id: string;
  title: string;
  kind: "students" | "staff";
  from_date: Date;
  to_date: Date;
  generated_by: string;
  role: string;
  section_id?: string;
  headers: any;
  rows: any;
  created_at: Date;
}

export async function generateStudentReport(
  client: PoolClient,
  fromDate: string,
  toDate: string,
  sectionId?: string,
  generatedBy: string = "demo"
): Promise<{ headers: string[]; columns: string[]; rows: ReportRow[] }> {
  // Validar rango de fechas
  if (fromDate > toDate) {
    throw new ValidationError("La fecha de inicio no puede ser posterior a la fecha de fin.");
  }

  // Obtener días lectivos en el rango (excluyendo fines de semana y días no lectivos del calendario)
  const lectiveDaysResult = await client.query(
    `WITH days AS (
       SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS school_date
     )
     SELECT school_date FROM days
      WHERE EXTRACT(ISODOW FROM school_date) < 6
      EXCEPT
      SELECT school_date FROM school_calendar WHERE lective = false`,
    [fromDate, toDate]
  );
  const lectiveDays = lectiveDaysResult.rows.map((r) => r.school_date);

  // Obtener estudiantes elegibles
  let studentsQuery = `
    SELECT DISTINCT s.siagie_code, s.given_names, s.family_names,
                    e.section_id, e.starts_on, e.ends_on
    FROM students s
    JOIN enrollments e ON e.student_id = s.siagie_code
    WHERE s.active = true
      AND e.starts_on <= $2::date
      AND (e.ends_on IS NULL OR e.ends_on > $1::date)
  `;
  const params: any[] = [fromDate, toDate];
  if (sectionId) {
    studentsQuery += ` AND e.section_id = $${params.length + 1}`;
    params.push(sectionId);
  }
  studentsQuery += ` ORDER BY s.family_names, s.given_names`;

  const studentsResult = await client.query(studentsQuery, params);
  const students = studentsResult.rows;

  const headers = [
    "Estudiante",
    "Sección",
    "Días lectivos",
    "A tiempo",
    "Tardanzas",
    "Faltas injust.",
    "Faltas just.",
    "Permisos",
    "Sin registro",
    "Asistencia %",
  ];
  const columns = [
    "name",
    "section",
    "totalDays",
    "present",
    "late",
    "absent",
    "excused",
    "permit",
    "none",
    "attendancePct",
  ];

  const rows: ReportRow[] = [];

  for (const s of students) {
    const counts = {
      present: 0,
      late: 0,
      absent: 0,
      excused: 0,
      permit: 0,
      none: 0,
    };

    const enrolledDays = lectiveDays.filter((day) => {
      const schoolDate = day instanceof Date
        ? day.toISOString().slice(0, 10)
        : String(day).slice(0, 10);
      const startsOn = s.starts_on instanceof Date
        ? s.starts_on.toISOString().slice(0, 10)
        : String(s.starts_on).slice(0, 10);
      const endsOn = s.ends_on == null
        ? null
        : s.ends_on instanceof Date
          ? s.ends_on.toISOString().slice(0, 10)
          : String(s.ends_on).slice(0, 10);
      return schoolDate >= startsOn && (endsOn === null || schoolDate < endsOn);
    });

    for (const day of enrolledDays) {
      const attResult = await client.query(
        `SELECT sa.status FROM student_attendance sa
         JOIN attendance_sessions ats ON ats.id = sa.session_id
         WHERE sa.student_id = $1
           AND ats.school_date = $2::date
         LIMIT 1`,
        [s.siagie_code, day]
      );
      if ((attResult.rowCount ?? 0) > 0) {
        const status = attResult.rows[0].status as keyof typeof counts;
        counts[status] += 1;
      } else {
        counts.none += 1;
      }
    }

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const pct = total > 0 ? (((counts.present + counts.late) / total) * 100).toFixed(1) : "—";

    rows.push({
      name: `${s.given_names} ${s.family_names}`,
      section: s.section_id,
      totalDays: enrolledDays.length,
      present: counts.present,
      late: counts.late,
      absent: counts.absent,
      excused: counts.excused,
      permit: counts.permit,
      none: counts.none,
      attendancePct: pct,
    });
  }

  await logAudit(
    client,
    generatedBy,
    `Se generó un reporte de asistencia de estudiantes del ${fromDate} al ${toDate}${sectionId ? ` (sección ${sectionId})` : ""}`
  );

  return { headers, columns, rows };
}

export async function generateStaffReport(
  client: PoolClient,
  fromDate: string,
  toDate: string,
  generatedBy: string = "demo"
): Promise<{ headers: string[]; columns: string[]; rows: StaffReportRow[] }> {
  if (fromDate > toDate) {
    throw new ValidationError("La fecha de inicio no puede ser posterior a la fecha de fin.");
  }

  const lectiveDaysResult = await client.query(
    `WITH days AS (
       SELECT generate_series($1::date, $2::date, '1 day'::interval)::date AS school_date
     )
     SELECT school_date FROM days
      WHERE EXTRACT(ISODOW FROM school_date) < 6
      EXCEPT
      SELECT school_date FROM school_calendar WHERE lective = false`,
    [fromDate, toDate]
  );
  const lectiveDays = lectiveDaysResult.rows.map((r) => r.school_date);

  const personnelResult = await client.query(
    `SELECT * FROM personnel WHERE active = true ORDER BY name`
  );
  const personnel = personnelResult.rows;

  const headers = [
    "Personal",
    "Cargo",
    "Turno",
    "Ingresos",
    "Tardanzas",
    "Sin ingreso",
    "Salidas",
  ];
  const columns = ["name", "role", "shift", "entries", "lates", "noEntry", "exits"];

  const rows: StaffReportRow[] = [];

  for (const p of personnel) {
    let entries = 0;
    let lates = 0;
    let noEntry = 0;
    let exits = 0;

    for (const day of lectiveDays) {
      const logResult = await client.query(
        `SELECT in_time, out_time FROM staff_logs
         WHERE personnel_id = $1 AND log_date = $2::date`,
        [p.id, day]
      );
      if ((logResult.rowCount ?? 0) > 0) {
        const log = logResult.rows[0];
        if (log.in_time) {
          entries += 1;
          const inHour = new Date(log.in_time).getHours();
          const startHour = p.shift === "Tarde" ? 13 : 8;
          if (inHour > startHour) lates += 1;
        } else {
          noEntry += 1;
        }
        if (log.out_time) exits += 1;
      } else {
        noEntry += 1;
      }
    }

    rows.push({
      name: p.name,
      role: p.role,
      shift: p.shift,
      entries,
      lates,
      noEntry,
      exits,
    });
  }

  await logAudit(
    client,
    generatedBy,
    `Se generó un reporte de asistencia de personal del ${fromDate} al ${toDate}`
  );

  return { headers, columns, rows };
}

export async function archiveReport(
  client: PoolClient,
  data: {
    title: string;
    kind: "students" | "staff";
    from_date: string;
    to_date: string;
    generated_by: string;
    role: string;
    section_id?: string;
    headers: any;
    rows: any;
  },
  byUser: string
): Promise<ReportArchiveRow> {
  const result = await client.query(
    `INSERT INTO report_archives (title, kind, from_date, to_date, generated_by, role, section_id, headers, rows)
     VALUES ($1, $2, $3::date, $4::date, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      data.title,
      data.kind,
      data.from_date,
      data.to_date,
      data.generated_by,
      data.role,
      data.section_id ?? null,
      JSON.stringify(data.headers),
      JSON.stringify(data.rows),
    ]
  );

  await logAudit(
    client,
    byUser,
    `Se archivó el reporte "${data.title}"`
  );

  return result.rows[0];
}

export async function listArchivedReports(
  client: PoolClient,
  role?: string,
  sectionId?: string
): Promise<ReportArchiveRow[]> {
  if (sectionId) {
    const result = await client.query(
      `SELECT * FROM report_archives
        WHERE kind = 'students' AND section_id = $1
        ORDER BY created_at DESC`,
      [sectionId]
    );
    return result.rows;
  }
  if (role) {
    const result = await client.query(
      `SELECT * FROM report_archives WHERE role = $1 OR role = 'direccion' ORDER BY created_at DESC`,
      [role]
    );
    return result.rows;
  }
  const result = await client.query(
    `SELECT * FROM report_archives ORDER BY created_at DESC`
  );
  return result.rows;
}

export async function getArchivedReport(
  client: PoolClient,
  id: string
): Promise<ReportArchiveRow | null> {
  const result = await client.query(
    `SELECT * FROM report_archives WHERE id = $1`,
    [id]
  );
  if (result.rowCount === 0) return null;
  return result.rows[0];
}
