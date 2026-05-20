import { cn } from "@/src/lib/utils";

export type ButtonVariant = "primary" | "neutral" | "ghost";
export type ButtonSize = "sm" | "default" | "lg";

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const base = cn(
  "inline-flex items-center justify-center font-body font-bold whitespace-nowrap",
  "cursor-pointer select-none transition-[transform,box-shadow] duration-[40ms]",
);

const sizeClasses: Record<ButtonSize, string> = {
  sm: "text-xs px-3 py-1.5",
  default: "text-sm px-4 py-2.5",
  lg: "text-base px-5 py-3",
};

// Primary + neutral get the flat Nagai shadow + press-collapse. Ghost is
// quiet — no shadow, no press effect — for low-emphasis chrome (theme
// toggle, nav links, etc.).
const variantClasses: Record<ButtonVariant, string> = {
  primary: cn(
    "border-[1.5px] border-border bg-brand text-brand-foreground",
    "shadow-flat-sm",
    "active:translate-x-[2px] active:translate-y-[2px]",
    "active:shadow-[2px_2px_0_var(--color-shadow)]",
  ),
  neutral: cn(
    "border-[1.5px] border-border bg-surface text-text",
    "shadow-flat-sm",
    "active:translate-x-[2px] active:translate-y-[2px]",
    "active:shadow-[2px_2px_0_var(--color-shadow)]",
  ),
  ghost: cn(
    "border-[1.5px] border-transparent bg-transparent text-text",
    "hover:bg-surface",
  ),
};

export function Button({
  variant = "primary",
  size = "default",
  className,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(base, sizeClasses[size], variantClasses[variant], className)}
      {...props}
    />
  );
}
