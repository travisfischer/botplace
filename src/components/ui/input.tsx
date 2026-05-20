import { cn } from "@/src/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "block w-full bg-surface text-text font-body text-sm",
        "border-[1.5px] border-border px-3 py-2",
        "placeholder:text-text-muted",
        "focus:outline-none focus:bg-bg focus:shadow-flat-sm",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        "transition-shadow",
        className,
      )}
      {...props}
    />
  );
}
