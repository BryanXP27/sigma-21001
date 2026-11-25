import type { PoolClient } from "pg";

export interface FamilyRecord {
  id: string;
  date: string;
  status: string;
  source: string;
  recordedAt: string;
}

export interface FamilyStudent {
  studentId: string;
  name: string;
  sectionId: string | null;
  sectionLabel: string | null;
  guardianName: string;
  relation: string | null;
  counts: {
    present: number;
    late: number;
    absent: number;
    excused: number;
    permit: number;
  };
  records: FamilyRecord[];
}

/**
 * Devuelve únicamente los estudiantes vinculados a la cuenta del apoderado,
 * junto con su historial reciente de asistencia.
 */
export async function getFamilyOverview(
  client: PoolClient,
  userId: string
): Promise<FamilyStudent[]> {
  const guardiansResult = await client.query(
    `SELECT g.name AS guardian_name,
            g.relation,
            s.siagie_code AS student_id,
            s.given_names,
            s.family_names,
            e.section_id,
            concat(sec.grade, '° ', sec.label) AS section_label
       FROM guardians g
       JOIN students s ON s.siagie_code = g.student_id
       LEFT JOIN enrollments e
              ON e.student_id = s.siagie_code
             AND e.status = 'active'
             AND e.starts_on <= current_date
             AND (e.ends_on IS NULL OR e.ends_on > current_date)
       LEFT JOIN sections sec ON sec.id = e.section_id
      WHERE g.user_id = $1
        AND s.active
      ORDER BY s.family_names, s.given_names`,
    [userId]
  );

  const students: FamilyStudent[] = [];

  for (const row of guardiansResult.rows) {
    const recordsResult = await client.query(
      `SELECT sa.id,
              ats.school_date::text AS date,
              sa.status,
              sa.source,
              sa.recorded_at AS "recordedAt"
         FROM student_attendance sa
         JOIN attendance_sessions ats ON ats.id = sa.session_id
        WHERE sa.student_id = $1
        ORDER BY ats.school_date DESC, sa.recorded_at DESC
        LIMIT 40`,
      [row.student_id]
    );

    const counts: FamilyStudent["counts"] = {
      present: 0,
      late: 0,
      absent: 0,
      excused: 0,
      permit: 0,
    };

    const records: FamilyRecord[] = recordsResult.rows.map((record: any) => {
      if (record.status in counts) {
        counts[record.status as keyof FamilyStudent["counts"]] += 1;
      }
      return {
        id: record.id,
        date: record.date,
        status: record.status,
        source: record.source,
        recordedAt:
          record.recordedAt instanceof Date
            ? record.recordedAt.toISOString()
            : String(record.recordedAt),
      };
    });

    students.push({
      studentId: row.student_id,
      name: `${row.given_names ?? ""} ${row.family_names ?? ""}`.trim(),
      sectionId: row.section_id ?? null,
      sectionLabel: row.section_label ?? null,
      guardianName: row.guardian_name,
      relation: row.relation ?? null,
      counts,
      records,
    });
  }

  return students;
}
