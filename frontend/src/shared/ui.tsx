import { createElement, useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { ICONS } from "./icons";

/** Icono SVG del conjunto Lucide usado por el prototipo aprobado. */
export function Icon({ name, size = 20, className = "" }: { name: string; size?: number; className?: string }) {
  const nodes = ICONS[name] ?? ICONS.info ?? [];
  return createElement(
    "svg",
    {
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.8,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      className,
    },
    nodes.map(([tag, attrs], index) => createElement(tag, { key: index, ...attrs }))
  );
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "white" | "warn";
  icon?: string;
  slim?: boolean;
};

export function Btn({ variant = "primary", icon, slim = false, className = "", children, ...rest }: BtnProps) {
  return (
    <button className={`btn ${variant === "primary" ? "" : variant} ${slim ? "slim" : ""} ${className}`} {...rest}>
      {icon && <Icon name={icon} size={15} />}
      {children}
    </button>
  );
}

export function Pill({ tone = "", children }: { tone?: "" | "green" | "orange" | "red" | "blue"; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function Metric({
  icon,
  title,
  value,
  note,
  tone = "",
}: {
  icon: string;
  title: string;
  value: ReactNode;
  note?: string;
  tone?: "" | "green" | "orange" | "red";
}) {
  return (
    <div className="metric">
      <div className="metric-top">
        <span className={`metric-icon ${tone}`}><Icon name={icon} size={17} /></span>
        {title}
      </div>
      <strong>{value}</strong>
      {note && <small>{note}</small>}
    </div>
  );
}

export function PageHead({
  eyebrow,
  title,
  detail,
  more,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  more?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{detail}</p>
      </div>
      {more}
    </div>
  );
}

export function Card({
  title,
  detail,
  body,
  more,
  pad = false,
}: {
  title?: string;
  detail?: string;
  body: ReactNode;
  more?: ReactNode;
  pad?: boolean;
}) {
  return (
    <section className={`card ${pad ? "pad" : ""}`}>
      {(title || more) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {detail && <p>{detail}</p>}
          </div>
          {more}
        </div>
      )}
      {body}
    </section>
  );
}

export function Table({
  headers,
  rows,
  emptyText = "No hay datos disponibles.",
}: {
  headers: string[];
  rows: Array<Array<ReactNode>>;
  emptyText?: string;
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.length ? (
            rows.map((row, rowIndex) => (
              <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
            ))
          ) : (
            <tr><td colSpan={headers.length}><div className="empty">{emptyText}</div></td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="toolbar">{children}</div>;
}

export function Summary({ children }: { children: ReactNode }) {
  return <div className="summary">{children}</div>;
}

export function Notice({
  children,
  tone = "",
}: {
  children: ReactNode;
  tone?: "" | "warn" | "good";
}) {
  return (
    <div className={`notice ${tone}`}>
      <Icon name={tone === "warn" ? "circle-alert" : tone === "good" ? "circle-check" : "info"} size={17} />
      <span>{children}</span>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty"><Icon name="inbox" size={30} />{children}</div>;
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
  return <span className="avatar">{initials}</span>;
}

export function PersonCell({ name, detail }: { name: string; detail?: string }) {
  return (
    <div className="row">
      <Avatar name={name} />
      <div>
        <strong>{name}</strong>
        {detail && <small>{detail}</small>}
      </div>
    </div>
  );
}

export function FeedRow({
  icon,
  tone = "",
  title,
  detail,
  trailing,
}: {
  icon: string;
  tone?: "" | "green" | "orange" | "red";
  title: string;
  detail?: string;
  trailing?: ReactNode;
}) {
  return (
    <div className="feed-item">
      <span className={`metric-icon ${tone}`}><Icon name={icon} size={14} /></span>
      <div><strong>{title}</strong>{detail && <small>{detail}</small>}</div>
      {trailing}
    </div>
  );
}

export function Chart({
  values,
  labels,
}: {
  values: Array<{ present: number; late: number }>;
  labels: string[];
}) {
  const max = Math.max(1, ...values.map((item) => item.present + item.late));
  return (
    <>
      <div className="chart">
        {values.map((item, index) => (
          <div className="bar-slot" key={index}>
            <div className="bar" style={{ height: `${(item.present / max) * 100}%` }} />
            <div className="bar alt" style={{ height: `${(item.late / max) * 100}%` }} />
            <span className="bar-day">{labels[index]}</span>
          </div>
        ))}
      </div>
      <div className="chart-key">
        <span><b />A tiempo</span>
        <span><b className="alt" />Tardanzas</span>
      </div>
    </>
  );
}

export function Modal({
  title,
  body,
  footer,
  onClose,
  open,
}: {
  title: string;
  body: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  open: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={dialogRef}
      className="sigma-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="modal-head">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Cerrar"><Icon name="x" size={17} /></button>
      </div>
      <div className="modal-body">{body}</div>
      {footer && <div className="modal-body row modal-actions">{footer}</div>}
    </dialog>
  );
}
