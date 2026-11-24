import { BRAND_PATHS } from "./brandPaths";
import type { BrandName } from "./brandPaths";

type Props = {
  name: BrandName;
  size?: number;
  className?: string;
  title?: string;
};

const EVEN_ODD = new Set<BrandName>(["roblox", "opencode"]);

export default function BrandIcon({ name, size = 16, className = "", title }: Props) {
  return (
    <svg
      className={`brand-icon is-${name}${className ? ` ${className}` : ""}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
    >
      {title ? <title>{title}</title> : null}
      <path
        d={BRAND_PATHS[name]}
        fillRule={EVEN_ODD.has(name) ? "evenodd" : undefined}
        clipRule={EVEN_ODD.has(name) ? "evenodd" : undefined}
      />
    </svg>
  );
}
