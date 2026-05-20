// Atmosphere layer panel — banded-sky gradient block per the Nagai
// design system's atmosphere spec. Hard-stop CSS gradients (never smooth
// blends); two registers — daytime (cobalt → cream) and sunset (indigo
// → gold). The hex literals here are atmosphere *spec*, not chrome
// styling — they live in the design system as the canonical sky bands,
// just like canvas drawing palettes (src/palettes/) live as data.
//
// Used by simple pages (auth) per requirement-20260520-0914 F8 to
// carry the vibe on otherwise-quiet surfaces.

import { cn } from "@/src/lib/utils";

export type AtmosphereRegister = "sunset" | "daytime";

export interface AtmospherePanelProps
  extends React.HTMLAttributes<HTMLDivElement> {
  register?: AtmosphereRegister;
  /** Render a small sun disc on the sky. Defaults to true for sunset,
   *  false for daytime (the daytime register reads as midday + cloud,
   *  not horizon — disc is optional). */
  withSun?: boolean;
}

// Canonical band stops from the design-system requirement.
const SUNSET_BANDS = `linear-gradient(to bottom,
  #3A4E8C 0 20%, #8B4E8E 20% 40%, #C2477E 40% 58%,
  #EE6C4D 58% 76%, #F4A06A 76% 90%, #F2C14E 90% 100%)`;
const DAYTIME_BANDS = `linear-gradient(to bottom,
  #1F5FA8 0 18%, #2D7DD2 18% 36%, #4A97D8 36% 52%,
  #79B8E0 52% 66%, #B3D9EC 66% 80%, #E7F1F2 80% 100%)`;

export function AtmospherePanel({
  register = "sunset",
  withSun,
  className,
  children,
  ...props
}: AtmospherePanelProps) {
  const showSun = withSun ?? register === "sunset";
  return (
    <div
      className={cn(
        "relative overflow-hidden border-[1.5px] border-border",
        className,
      )}
      style={{
        background: register === "sunset" ? SUNSET_BANDS : DAYTIME_BANDS,
      }}
      {...props}
    >
      {showSun ? (
        <span
          aria-hidden
          className="absolute rounded-full"
          style={{
            width: "14%",
            aspectRatio: "1",
            top: "44%",
            right: "16%",
            background: "#F4D662",
            border: "1.5px solid #2B2A24",
          }}
        />
      ) : null}
      {children}
    </div>
  );
}
