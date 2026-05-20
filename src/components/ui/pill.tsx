import { cn } from "@/src/lib/utils";

export type PillVariant =
  | "default"
  | "info"     // pool — supporting info
  | "success"  // palm
  | "warning"  // sun
  | "live"     // accent — "look here", energy
  | "new";     // accent — alias for live in a different surface context

export interface PillProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: PillVariant;
}

const variantClasses: Record<PillVariant, string> = {
  default: "bg-surface text-text",
  info: "bg-pool text-pool-foreground",
  success: "bg-palm text-palm-foreground",
  warning: "bg-sun text-sun-foreground",
  live: "bg-accent text-accent-foreground",
  new: "bg-accent text-accent-foreground",
};

export function Pill({
  variant = "default",
  className,
  children,
  ...props
}: PillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-0.5 text-xs font-bold",
        "uppercase tracking-[0.08em]",
        "border-[1.5px] border-border rounded-full",
        variantClasses[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
