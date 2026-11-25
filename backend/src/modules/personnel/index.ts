import { PoolClient } from "pg";
import { pool } from "../../core/db.js";
import { logAudit } from "../../core/auth.js";
import { NotFoundError, ValidationError } from "../../core/errors.js";

export interface PersonnelRow {
  id: string;
  name: string;
  role: string;
  shift: "Mañana" | "Tarde";
  contact?: string;
  doc?: string;
  active: boolean;
  qr: number;
  created_at: Date;
}

export async function listPersonnel(
  client: PoolClient,
  shift?: string
): Promise<PersonnelRow[]> {
  if (shift) {
    const result = await client.query(
      `SELECT * FROM personnel WHERE shift = $1 ORDER BY name`,
      [shift]
    );
    return result.rows;
  }
  const result = await client.query(`SELECT * FROM personnel ORDER BY name`);
  return result.rows;
}

export async function getPersonnel(
  client: PoolClient,
  id: string
): Promise<PersonnelRow | null> {
  const result = await client.query(`SELECT * FROM personnel WHERE id = $1`, [id]);
  if (result.rowCount === 0) return null;
  return result.rows[0];
}

export async function createPersonnel(
  client: PoolClient,
  data: {
    id: string;
    name: string;
    role: string;
    shift: "Mañana" | "Tarde";
    contact?: string;
    doc?: string;
    active?: boolean;
    qr?: number;
  },
  byUser: string
): Promise<PersonnelRow> {
  const existing = await getPersonnel(client, data.id);
  if (existing) {
    throw new ValidationError("Ya existe un registro de personal con ese ID.");
  }

  const result = await client.query(
    `INSERT INTO personnel (id, name, role, shift, contact, doc, active, qr)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      data.id,
      data.name,
      data.role,
      data.shift,
      data.contact ?? null,
      data.doc ?? null,
      data.active ?? true,
      data.qr ?? 0,
    ]
  );

  await logAudit(
    client,
    byUser,
    `Se creó el personal ${data.name} (${data.id})`
  );

  return result.rows[0];
}

export async function updatePersonnel(
  client: PoolClient,
  id: string,
  data: {
    name?: string;
    role?: string;
    shift?: "Mañana" | "Tarde";
    contact?: string;
    doc?: string;
    active?: boolean;
    qr?: number;
  },
  byUser: string
): Promise<PersonnelRow> {
  const existing = await getPersonnel(client, id);
  if (!existing) {
    throw new NotFoundError("Personal no encontrado.");
  }

  const result = await client.query(
    `UPDATE personnel
       SET name = COALESCE($1, name),
           role = COALESCE($2, role),
           shift = COALESCE($3, shift),
           contact = COALESCE($4, contact),
           doc = COALESCE($5, doc),
           active = COALESCE($6, active),
           qr = COALESCE($7, qr)
     WHERE id = $8
     RETURNING *`,
    [data.name, data.role, data.shift, data.contact, data.doc, data.active, data.qr, id]
  );

  await logAudit(client, byUser, `Se actualizó el personal ${id}`);

  return result.rows[0];
}

export async function deletePersonnel(
  client: PoolClient,
  id: string,
  byUser: string
): Promise<void> {
  const existing = await getPersonnel(client, id);
  if (!existing) {
    throw new NotFoundError("Personal no encontrado.");
  }

  await client.query(`DELETE FROM personnel WHERE id = $1`, [id]);

  await logAudit(client, byUser, `Se eliminó el personal ${id}`);
}

export async function markStaffAttendance(
  client: PoolClient,
  data: {
    personnel_id: string;
    log_date: string;
    kind: "in" | "out";
    clock: string;
    source?: string;
  },
  byUser: string
): Promise<{ in_time?: string; out_time?: string }> {
  const existing = await getPersonnel(client, data.personnel_id);
  if (!existing || !existing.active) {
    throw new ValidationError("La persona no existe o está inactiva.");
  }

  let log = await client.query(
    `SELECT * FROM staff_logs WHERE personnel_id = $1 AND log_date = $2::date`,
    [data.personnel_id, data.log_date]
  );

  if (log.rowCount === 0) {
    await client.query(
      `INSERT INTO staff_logs (personnel_id, log_date, in_time, out_time, source)
       VALUES ($1, $2::date, NULL, NULL, $3)`,
      [data.personnel_id, data.log_date, data.source ?? "manual"]
    );
    log = await client.query(
      `SELECT * FROM staff_logs WHERE personnel_id = $1 AND log_date = $2::date`,
      [data.personnel_id, data.log_date]
    );
  }

  const currentLog = log.rows[0];

  if (data.kind === "in") {
    if (currentLog.in_time) {
      throw new ValidationError("Ya existe un registro de ingreso para esta fecha.");
    }
    await client.query(
      `UPDATE staff_logs
          SET in_time = ($1::timestamp AT TIME ZONE 'America/Lima')
        WHERE personnel_id = $2 AND log_date = $3::date`,
      [`${data.log_date} ${data.clock}`, data.personnel_id, data.log_date]
    );
  } else {
    if (!currentLog.in_time) {
      throw new ValidationError("Debe registrar un ingreso antes de la salida.");
    }
    if (currentLog.out_time) {
      throw new ValidationError("Ya existe un registro de salida para esta fecha.");
    }
    await client.query(
      `UPDATE staff_logs
          SET out_time = ($1::timestamp AT TIME ZONE 'America/Lima')
        WHERE personnel_id = $2 AND log_date = $3::date`,
      [`${data.log_date} ${data.clock}`, data.personnel_id, data.log_date]
    );
  }

  await logAudit(
    client,
    byUser,
    `Se marcó ${data.kind === "in" ? "ingreso" : "salida"} de personal ${data.personnel_id} en ${data.log_date}`
  );

  const updated = await client.query(
    `SELECT in_time, out_time FROM staff_logs WHERE personnel_id = $1 AND log_date = $2::date`,
    [data.personnel_id, data.log_date]
  );

  return {
    in_time: updated.rows[0].in_time,
    out_time: updated.rows[0].out_time,
  };
}
