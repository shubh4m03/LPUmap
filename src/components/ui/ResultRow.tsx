import { Fragment, type MouseEvent, type ReactNode } from 'react';
import { Icon } from '../icons/index.ts';
import type { IconName } from '../icons/index.ts';
import { cx, FOCUS_RING } from './cx.ts';

export interface TitleSegment {
  text: string;
  match: boolean;
}

export interface ResultRowProps {
  title: string;
  /** Highlight segments (e.g. from search `highlightSegments`); must join back to `title`. */
  segments?: readonly TitleSegment[];
  /** Custom segment renderer; defaults to <mark> for matches. */
  renderSegment?: (segment: TitleSegment, index: number) => ReactNode;
  subtitle?: ReactNode;
  /** Lines the subtitle may use before it is cut off (default 1). */
  subtitleLines?: 1 | 2;
  /** Trailing meta such as distance or a badge. */
  meta?: ReactNode;
  icon?: IconName;
  /** Icon tint (e.g. CategoryDef.color); the icon is decorative so this is not the only cue. */
  iconColor?: string;
  /**
   * 'option' renders a listbox option (role=option + aria-selected) for comboboxes that
   * manage focus via aria-activedescendant; 'button' renders a standalone button.
   */
  as?: 'option' | 'button';
  id?: string;
  active?: boolean;
  onSelect?: () => void;
  className?: string;
}

function defaultSegment(seg: TitleSegment): ReactNode {
  return seg.match ? (
    <mark className="bg-highlight font-semibold text-text">{seg.text}</mark>
  ) : (
    <span>{seg.text}</span>
  );
}

export function ResultRow({
  title,
  segments,
  renderSegment = defaultSegment,
  subtitle,
  subtitleLines = 1,
  meta,
  icon,
  iconColor,
  as = 'button',
  id,
  active = false,
  onSelect,
  className,
}: ResultRowProps) {
  const useSegments = segments && segments.map((s) => s.text).join('') === title;
  const body = (
    <>
      {icon ? (
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-surface-sunken"
          style={iconColor ? { color: iconColor } : undefined}
        >
          <Icon name={icon} size={18} />
        </span>
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        {/* whitespace-pre (not truncate's nowrap): printed artwork labels keep their exact double spaces. */}
        <span className="overflow-hidden text-sm font-medium text-ellipsis whitespace-pre text-text">
          {useSegments ? (
            <>
              {/* Screen readers split words at <mark> boundaries; give them the plain title. */}
              <span aria-hidden="true">
                {segments.map((s, i) => (
                  <Fragment key={i}>{renderSegment(s, i)}</Fragment>
                ))}
              </span>
              <span className="sr-only">{title}</span>
            </>
          ) : (
            title
          )}
        </span>
        {subtitle ? (
          <span
            data-lines={subtitleLines}
            className={cx(
              'text-sm text-muted',
              subtitleLines === 2 ? 'line-clamp-2 break-words' : 'truncate',
            )}
          >
            {subtitle}
          </span>
        ) : null}
      </span>
      {meta ? <span className="shrink-0 self-center text-xs text-subtle">{meta}</span> : null}
    </>
  );

  const classes = cx(
    'flex w-full items-start gap-3 px-3 py-2 text-left min-h-12 cursor-pointer',
    active ? 'bg-surface-hover shadow-[inset_3px_0_0_var(--ds-accent)]' : 'hover:bg-surface-hover',
    className,
  );

  if (as === 'option') {
    return (
      <div
        id={id}
        role="option"
        aria-selected={active}
        className={classes}
        // Keep focus in the combobox input while clicking an option.
        onMouseDown={(e: MouseEvent) => e.preventDefault()}
        onClick={onSelect}
      >
        {body}
      </div>
    );
  }
  return (
    <button id={id} type="button" className={cx(classes, FOCUS_RING)} onClick={onSelect}>
      {body}
    </button>
  );
}
