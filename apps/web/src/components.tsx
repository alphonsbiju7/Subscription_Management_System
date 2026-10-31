import { useEffect, useRef, type ReactNode } from "react";
import {
  X,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Inbox,
  LoaderCircle,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { value, text, type RecordData } from "./api";
export function Badge({ children }: { children: unknown }) {
  const s = text(children);
  return (
    <span className={`badge badge-${s.toLowerCase().replaceAll("_", "-")}`}>
      {s.replaceAll("_", " ")}
    </span>
  );
}
export function ErrorBox({ error }: { error: unknown }) {
  return error ? (
    <div role="alert" className="error">
      <AlertCircle size={18} />
      {error instanceof Error ? error.message : String(error)}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div role="status" className="loading">
      <LoaderCircle className="spin" size={22} />
      Loading workspace data…
    </div>
  );
}
export function Empty({
  children = "No records yet. Create your first record to get started.",
}: {
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <Inbox size={34} />
      <h3>Nothing here yet</h3>
      <p>{children}</p>
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className={`modal ${wide ? "modal-wide" : ""}`}
      onCancel={close}
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button
          aria-label="Close dialog"
          className="icon-button"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export type Field = {
  name: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  initial?: string;
  hint?: string;
  autoComplete?: string;
};
export function Form({
  fields,
  onSubmit,
  pending,
  error,
  submit = "Save record",
  pendingLabel = "Saving…",
  extra,
}: {
  fields: Field[];
  onSubmit: (v: Record<string, string>) => void;
  pending?: boolean;
  error?: unknown;
  submit?: string;
  pendingLabel?: string;
  extra?: ReactNode;
}) {
  const schema = z.object(
    Object.fromEntries(
      fields.map((f) => [
        f.name,
        f.required ? z.string().min(1, `${f.label} is required`) : z.string(),
      ]),
    ),
  );
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Record<string, string>>({
    resolver: zodResolver(schema),
    defaultValues: Object.fromEntries(
      fields.map((f) => [f.name, f.initial ?? ""]),
    ),
  });
  return (
    <form className="form" onSubmit={handleSubmit(onSubmit)}>
      <div className="form-grid">
        {fields.map((f) => (
          <label
            key={f.name}
            className={f.type === "textarea" ? "full-width" : ""}
          >
            <span>
              {f.label}
              {f.required ? " *" : ""}
            </span>
            {f.type === "select" ? (
              <select aria-label={f.label} {...register(f.name)}>
                <option value="">Choose…</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea aria-label={f.label} rows={3} {...register(f.name)} />
            ) : (
              <input
                aria-label={f.label}
                type={f.type ?? "text"}
                autoComplete={f.autoComplete}
                step={f.type === "number" ? "any" : undefined}
                {...register(f.name)}
              />
            )}{" "}
            {f.hint && <small>{f.hint}</small>}
            {errors[f.name] && (
              <small className="field-error">
                {String(errors[f.name]?.message)}
              </small>
            )}
          </label>
        ))}
      </div>
      {extra}
      <ErrorBox error={error} />
      <div className="form-footer">
        <button className="button primary" disabled={pending}>
          {pending ? pendingLabel : submit}
        </button>
      </div>
    </form>
  );
}
export type Column = {
  key: string;
  label: string;
  render?: (row: RecordData) => ReactNode;
};
export function Table({
  items,
  columns,
  actions,
  onOpen,
}: {
  items: RecordData[];
  columns: Column[];
  actions?: (row: RecordData) => ReactNode;
  onOpen?: (row: RecordData) => void;
}) {
  if (!items.length) return <Empty />;
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
            {actions && (
              <th>
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((row) => (
            <tr key={row.id}>
              {columns.map((c, i) => (
                <td key={c.key}>
                  {i === 0 && onOpen ? (
                    <button className="record-link" onClick={() => onOpen(row)}>
                      {c.render ? c.render(row) : text(value(row, c.key))}
                    </button>
                  ) : c.render ? (
                    c.render(row)
                  ) : (
                    text(value(row, c.key))
                  )}
                </td>
              ))}
              {actions && <td className="row-actions">{actions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function Pagination({
  page,
  total,
  setPage,
}: {
  page: number;
  total: number;
  setPage: (p: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {total} records · Page {page} of {Math.max(1, Math.ceil(total / 25))}
      </span>
      <div>
        <button
          className="icon-button"
          aria-label="Previous page"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft size={18} />
        </button>
        <button
          className="icon-button"
          aria-label="Next page"
          disabled={page * 25 >= total}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
