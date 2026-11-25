import type { AttendanceStatus, Section } from "../types";

/** Hora local de Perú en formato HH:MM:SS. */
export function peruClock(date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Lima",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

/**
 * Estado sugerido por la hora de marcación y el turno de la sección.
 * El prototipo considera la jornada iniciada a las 08:00 / 13:00 y aplica
 * los cortes configurables de mañana y tarde.
 */
export function proposedStatus(
  clock: string,
  section: Section | undefined,
  cutAM = "09:00:00",
  cutPM = "14:00:00"
): AttendanceStatus {
  const start = section?.shift === "Tarde" ? "13:00:00" : "08:00:00";
  const cut = section?.shift === "Tarde" ? cutPM : cutAM;
  const normalizedCut = cut.length === 5 ? `${cut}:00` : cut;
  return clock > normalizedCut ? "absent" : clock > start ? "late" : "present";
}

/** Valida el formato SIGMA:E:<siagie>:<qr> o un código SIAGIE directo. */
export function parseQrCode(
  value: string
): { studentId: string; qr: number | null } | null {
  const input = value.trim();
  const match = /^SIGMA:[EP]:([^:]+):(\d+)(?::[a-f0-9]{48})?$/.exec(input);
  if (match) {
    return { studentId: match[1], qr: Number(match[2]) };
  }
  if (/^\d{14}$/.test(input)) {
    return { studentId: input, qr: null };
  }
  return null;
}

/** Valida el formato del carné y devuelve el QR esperado. */
export function expectedQr(value: string, studentId: string, qr: number): boolean {
  const parsed = parseQrCode(value);
  if (!parsed || parsed.studentId !== studentId) return false;
  return parsed.qr === null || parsed.qr === qr;
}
