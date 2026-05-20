import { cn } from "@/src/lib/utils";

export type TableProps = React.TableHTMLAttributes<HTMLTableElement>;

/**
 * Token-driven table. Header row sits on `--bg`; body rows on `--surface`
 * with `--border` rules between them. Wrapped in an overflow-x-auto div
 * so long tables don't break narrow shells.
 */
export function Table({ className, ...props }: TableProps) {
  return (
    <div className="overflow-x-auto border-[1.5px] border-border bg-surface">
      <table
        className={cn("w-full text-sm border-collapse", className)}
        {...props}
      />
    </div>
  );
}

export function THead({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
  return (
    <thead
      className={cn("bg-bg border-b-[1.5px] border-border", className)}
      {...props}
    />
  );
}

export function TBody(props: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...props} />;
}

export function Tr({
  className,
  ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn(
        "border-t-[1.5px] border-border first:border-t-0",
        className,
      )}
      {...props}
    />
  );
}

export function Th({
  className,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "text-left px-3 py-2 font-bold uppercase tracking-[0.08em] text-xs text-text-muted",
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  className,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-2.5 align-top", className)} {...props} />;
}
