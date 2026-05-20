import { cn } from "@/src/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <textarea
      className={cn(
        "block w-full bg-surface text-text font-body text-sm",
        "border-[1.5px] border-border px-3 py-2 resize-y",
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
