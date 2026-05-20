import { cn } from "@/src/lib/utils";

export type LabelProps = React.LabelHTMLAttributes<HTMLLabelElement>;

export function Label({ className, ...props }: LabelProps) {
  return (
    <label
      className={cn(
        "block text-xs font-bold text-text-muted uppercase tracking-[0.08em] mb-1.5",
        className,
      )}
      {...props}
    />
  );
}
