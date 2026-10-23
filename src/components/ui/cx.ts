/** Joins truthy class names. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/** Shared focus ring for custom controls (the base stylesheet covers native ones). */
export const FOCUS_RING =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

/** Shared button chrome; 44px minimum targets on touch screens (WCAG 2.5.8 + platform guidance). */
export const BUTTON_BASE =
  'inline-flex items-center justify-center rounded-md font-medium select-none ' +
  'transition-colors duration-fast ease-standard ' +
  'disabled:cursor-not-allowed disabled:opacity-50 aria-busy:cursor-progress ' +
  'pointer-coarse:min-h-11 pointer-coarse:min-w-11 ' +
  FOCUS_RING;
