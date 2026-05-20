import { cn } from "@/src/lib/utils";

export type DataListProps = React.HTMLAttributes<HTMLDListElement>;

/**
 * Two-column key/value layout. Labels render small + muted + uppercase
 * (matching the section-label idiom on /styleguide); values are body text.
 * Wrap rows in `<DataListItem label="…">value</DataListItem>` — the item
 * outputs a `<dt>/<dd>` pair into the parent grid.
 */
export function DataList({ className, ...props }: DataListProps) {
  return (
    <dl
      className={cn(
        "grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2.5 text-sm",
        className,
      )}
      {...props}
    />
  );
}

export interface DataListItemProps {
  label: React.ReactNode;
  children: React.ReactNode;
}

export function DataListItem({ label, children }: DataListItemProps) {
  return (
    <>
      <dt className="font-bold text-text-muted uppercase tracking-[0.08em] text-xs self-center">
        {label}
      </dt>
      <dd className="text-text">{children}</dd>
    </>
  );
}
