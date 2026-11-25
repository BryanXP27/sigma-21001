import JSZip from "jszip";
import QRCode from "qrcode";

/** Descarga un archivo generado en el navegador. */
export function download(name: string, content: BlobPart, type: string): void {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Escapa valores que podrían interpretarse como fórmulas en Excel. */
export function csvValue(value: unknown): string {
  let text = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function csvDownload(name: string, rows: unknown[][]): void {
  const content = "\uFEFF" + rows.map((row) => row.map(csvValue).join(";")).join("\r\n");
  download(name, content, "text/csv;charset=utf-8");
}

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const PKG = "http://schemas.openxmlformats.org/package/2006";
const OFFICE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XLS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function xmlText(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

function baseOffice(path: string, contentType: string): JSZip {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `${XML}<Types xmlns="${PKG}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/${path}" ContentType="${contentType}"/></Types>`
  );
  zip.file(
    "_rels/.rels",
    `${XML}<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${OFFICE}/officeDocument" Target="${path}"/></Relationships>`
  );
  return zip;
}

/** Genera un archivo .xlsx compatible con Excel y LibreOffice. */
export async function workbook(name: string, rows: unknown[][]): Promise<void> {
  const zip = baseOffice(
    "xl/workbook.xml",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
  );
  const contentTypes = await zip.file("[Content_Types].xml")!.async("string");
  zip.file(
    "[Content_Types].xml",
    contentTypes.replace(
      "</Types>",
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
    )
  );
  zip.file(
    "xl/workbook.xml",
    `${XML}<workbook xmlns="${XLS}" xmlns:r="${OFFICE}"><sheets><sheet name="SIGMA 21001" sheetId="1" r:id="rId1"/></sheets></workbook>`
  );
  zip.file(
    "xl/_rels/workbook.xml.rels",
    `${XML}<Relationships xmlns="${PKG}/relationships"><Relationship Id="rId1" Type="${OFFICE}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`
  );
  const sheetRows = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((value, colIndex) => {
            const cell = `${String.fromCharCode(65 + colIndex)}${rowIndex + 1}`;
            return typeof value === "number"
              ? `<c r="${cell}"><v>${value}</v></c>`
              : `<c r="${cell}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
          })
          .join("")}</row>`
    )
    .join("");
  zip.file(
    "xl/worksheets/sheet1.xml",
    `${XML}<worksheet xmlns="${XLS}"><sheetData>${sheetRows}</sheetData></worksheet>`
  );
  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    compression: "DEFLATE",
  });
  download(name, blob, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
}

/** Genera un archivo .docx con párrafos y, opcionalmente, una tabla. */
export async function word(
  name: string,
  title: string,
  lines: string[],
  rows: unknown[][] | null = null
): Promise<void> {
  const zip = baseOffice(
    "word/document.xml",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
  );
  const paragraph = (value: unknown, bold = false) =>
    `<w:p><w:r>${bold ? "<w:rPr><w:b/></w:rPr>" : ""}<w:t xml:space="preserve">${xmlText(value)}</w:t></w:r></w:p>`;
  const table = rows
    ? `<w:tbl><w:tblPr><w:tblBorders><w:top w:val="single"/><w:left w:val="single"/><w:bottom w:val="single"/><w:right w:val="single"/><w:insideH w:val="single"/><w:insideV w:val="single"/></w:tblBorders></w:tblPr>${rows
        .map(
          (row, index) =>
            `<w:tr>${row.map((cell) => `<w:tc>${paragraph(cell, index === 0)}</w:tc>`).join("")}</w:tr>`
        )
        .join("")}</w:tbl>`
    : "";
  zip.file(
    "word/document.xml",
    `${XML}<w:document xmlns:w="${WORD}"><w:body>${paragraph(title, true)}${lines
      .map((line) => paragraph(line))
      .join("")}${table}<w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="800" w:right="800" w:bottom="800" w:left="800"/></w:sectPr></w:body></w:document>`
  );
  const blob = await zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    compression: "DEFLATE",
  });
  download(name, blob, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
}

/** Abre una ventana de impresión para guardar el reporte como PDF. */
export function printReport(
  title: string,
  subtitle: string,
  headers: string[],
  rows: unknown[][]
): void {
  const win = window.open("", "_blank");
  if (!win) return;
  const head = headers
    .map((header) => `<th style="padding:8px;border:1px solid #999">${xmlText(header)}</th>`)
    .join("");
  const body = rows
    .map(
      (row) =>
        `<tr>${row
          .map((cell) => `<td style="padding:6px;border:1px solid #ccc">${xmlText(cell)}</td>`)
          .join("")}</tr>`
    )
    .join("");
  win.document.write(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${xmlText(title)}</title><style>body{font-family:Arial,sans-serif;font-size:11px}table{border-collapse:collapse;width:100%}</style></head><body><h2>${xmlText(title)}</h2><p>${xmlText(subtitle)}</p><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`
  );
  win.document.close();
  win.focus();
  win.print();
}

/** Contenido del carné en el formato acordado con la demo. */
export function qrValue(
  id: string,
  type: "students" | "staff",
  qr: number,
  familyQrToken?: string
): string {
  const base = `SIGMA:${type === "students" ? "E" : "P"}:${id}:${qr || 0}`;
  return type === "students" && familyQrToken
    ? `${base}:${familyQrToken}`
    : base;
}

export function qrDataUrl(value: string): Promise<string> {
  return QRCode.toDataURL(value, {
    margin: 1,
    width: 240,
    errorCorrectionLevel: "M",
    color: { dark: "#142448", light: "#ffffff" },
  });
}

function readCsv(text: string): string[][] {
  const cleaned = text.replace(/^\uFEFF/, "");
  const separator = cleaned.split(/\r?\n/, 1)[0].includes(";") ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < cleaned.length; index += 1) {
    const char = cleaned[index];
    if (char === '"') {
      if (quoted && cleaned[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (!quoted && char === separator) {
      row.push(value);
      value = "";
    } else if (!quoted && char === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += char;
    }
  }
  if (row.length || value) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function columnIndex(label: string): number {
  return [...label].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
}

/** Lee un CSV o la primera hoja de un .xlsx. */
export async function rowsFrom(file: File): Promise<string[][]> {
  if (file.name.toLowerCase().endsWith(".csv")) {
    return readCsv(await file.text());
  }
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const sheet =
    zip.file("xl/worksheets/sheet1.xml") ??
    zip.file(/^xl\/worksheets\/sheet\d+\.xml$/)[0];
  if (!sheet) throw new Error("No se encontró la primera hoja de cálculo.");
  const parser = new DOMParser();
  const stringsFile = zip.file("xl/sharedStrings.xml");
  const parse = async (target: JSZip.JSZipObject) =>
    parser.parseFromString(await target.async("string"), "application/xml");
  const shared = stringsFile
    ? [...(await parse(stringsFile)).getElementsByTagName("si")].map((node) =>
        [...node.getElementsByTagName("t")].map((item) => item.textContent ?? "").join("")
      )
    : [];
  const rows: string[][] = [];
  const sheetDocument = await parse(sheet);
  for (const row of [...sheetDocument.getElementsByTagName("row")]) {
    const rowNumber = Number(row.getAttribute("r") || rows.length + 1);
    if (rowNumber > 20000) throw new Error("La hoja supera el límite de 20 000 filas.");
    const values: string[] = [];
    for (const cell of [...row.getElementsByTagName("c")]) {
      const column = columnIndex(cell.getAttribute("r")?.match(/^[A-Z]+/)?.[0] ?? "A");
      const raw = cell.getElementsByTagName("v")[0]?.textContent ?? "";
      const type = cell.getAttribute("t");
      values[column] =
        type === "s"
          ? shared[Number(raw)] ?? ""
          : type === "inlineStr"
            ? [...cell.getElementsByTagName("t")].map((item) => item.textContent ?? "").join("")
            : raw;
    }
    rows[rowNumber - 1] = values;
  }
  return rows;
}
