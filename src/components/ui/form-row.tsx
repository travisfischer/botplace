import { cn } from "@/src/lib/utils";

export type FormRowProps = React.HTMLAttributes<HTMLDivElement>;

export function FormRow({ className, ...props }: FormRowProps) {
  return <div className={cn("mb-4 last:mb-0", className)} {...props} />;
}
