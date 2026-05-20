import { cn } from "@/src/lib/utils";
import { Mark, type MarkProps } from "./mark";

export interface WordmarkProps {
  /** Mark pixel size. Text scales relative to this. Default 22. */
  size?: number;
  /** Explicit text size override (px). Default `round(size * 0.85)`. */
  textSize?: number;
  /** Apply the reserved bordered variant on the mark. Default false. */
  bordered?: boolean;
  /** Which mark register. Default "sunset". */
  register?: MarkProps["register"];
  className?: string;
}

/**
 * BOTPLACE wordmark lockup: mark + Silkscreen text. Silkscreen is reserved
 * for this single element — era signal scoped to identity.
 */
export function Wordmark({
  size = 22,
  textSize,
  bordered = false,
  register = "sunset",
  className,
}: WordmarkProps) {
  const ts = textSize ?? Math.round(size * 0.85);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2.5 align-middle",
        className,
      )}
    >
      <Mark size={size} bordered={bordered} register={register} />
      <span
        className="font-wordmark leading-none"
        style={{ fontSize: ts, letterSpacing: "0.04em" }}
      >
        BOTPLACE
      </span>
    </span>
  );
}
