import { cn } from "@/src/lib/utils";

/**
 * The Botplace mark. A banded Nagai sunset (or daytime) sky with a small
 * yellow sun disc. Borderless by default; `bordered` for the reserved
 * "framed / vintage record-label" variant.
 *
 * Hex literals below are an INTENTIONAL exception to the "no hex in JSX"
 * rule: these colors ARE the mark's identity spec, not a styling decision.
 * They live here (and in app/icon.svg) and nowhere else.
 *
 * @see plans/requirements/requirement-20260519-1500-nagai-design-system.md
 */

const SUNSET_GRADIENT = `linear-gradient(to bottom,
  #3A4E8C 0 20%, #8B4E8E 20% 40%, #C2477E 40% 58%,
  #EE6C4D 58% 76%, #F4A06A 76% 90%, #F2C14E 90% 100%)`;

const DAY_GRADIENT = `linear-gradient(to bottom,
  #1F5FA8 0 18%, #2D7DD2 18% 36%, #4A97D8 36% 52%,
  #79B8E0 52% 66%, #B3D9EC 66% 80%, #E7F1F2 80% 100%)`;

const SUN_COLOR = "#F4D662";

export type MarkRegister = "sunset" | "day";

export interface MarkProps {
  /** Pixel size (width = height). Default 22 (topbar size). */
  size?: number;
  /** Apply the reserved bordered variant. Default false (borderless). */
  bordered?: boolean;
  /** Which gradient register. Default "sunset". */
  register?: MarkRegister;
  /** Whether to render the sun disc. Default true at every scale. */
  withSun?: boolean;
  className?: string;
}

export function Mark({
  size = 22,
  bordered = false,
  register = "sunset",
  withSun = true,
  className,
}: MarkProps) {
  const gradient = register === "sunset" ? SUNSET_GRADIENT : DAY_GRADIENT;
  // Sun sits in the painting's "horizon" — different y for each register.
  const sunTop = register === "sunset" ? "50%" : "24%";

  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-block overflow-hidden shrink-0 align-middle",
        bordered && "border-[1.5px] border-border",
        className,
      )}
      style={{ width: size, height: size, background: gradient }}
    >
      {withSun && (
        <span
          className="absolute rounded-full"
          style={{
            width: "30%",
            height: "30%",
            top: sunTop,
            right: "20%",
            background: SUN_COLOR,
          }}
        />
      )}
    </span>
  );
}
