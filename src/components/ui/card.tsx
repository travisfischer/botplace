import { cn } from "@/src/lib/utils";

export type CardProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * Surface panel with flat ink border + Nagai flat-shadow elevation. The
 * system's default container. Padding is opinionated; pass `className` to
 * override.
 */
export function Card({ className, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "bg-surface border-[1.5px] border-border shadow-flat p-6",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
