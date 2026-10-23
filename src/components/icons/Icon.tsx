import { useId, type SVGProps } from 'react';
import { ICON_PATHS, type IconName } from './icon-paths.ts';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'name'> {
  name: IconName;
  /** Rendered size in px (square). Defaults to 20. */
  size?: number;
  /**
   * Accessible name for a standalone, meaningful icon. Without it the icon is
   * decorative and hidden from assistive technology (the usual case: icons sit
   * next to visible text or inside a labelled button).
   */
  title?: string;
}

export function Icon({ name, size = 20, title, className, ...rest }: IconProps) {
  const titleId = useId();
  const paths = ICON_PATHS[name];
  const labelled = typeof title === 'string' && title.length > 0;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      className={className ? `shrink-0 ${className}` : 'shrink-0'}
      data-icon={name}
      {...(labelled ? { role: 'img', 'aria-labelledby': titleId } : { 'aria-hidden': true })}
      {...rest}
    >
      {labelled ? <title id={titleId}>{title}</title> : null}
      {paths.map((path, i) => (
        <path key={i} d={path.d} {...(path.fill ? { fill: 'currentColor', stroke: 'none' } : null)} />
      ))}
    </svg>
  );
}
