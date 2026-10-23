import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useAtlas } from '../../app/data/atlas-context.ts';
import { placeEndpoint, routeBlockReason } from '../../app/place-actions.ts';
import type { Place } from '../../data/index.ts';
import type { RouteEndpoint } from '../../routing/index.ts';
import { Icon, TextInput, cx } from '../ui/index.ts';

const LIMIT = 8;

interface Option {
  id: string;
  place: Place;
  subtitle: string | undefined;
  endpoint: RouteEndpoint | null;
  /** Why this place cannot be a route endpoint (shown as text, option disabled). */
  blocked: string | null;
}

export interface EndpointSearchProps {
  /** e.g. "start" or "destination". */
  roleLabel: string;
  onPick(endpoint: RouteEndpoint): void;
  disabled?: boolean;
  /** Move focus into the box when it appears (the user pressed "Change"). */
  autoFocus?: boolean;
}

/**
 * Inline place search (combobox + listbox) over the shared search index.
 * Places that cannot be routed to stay visible but disabled, with the reason.
 */
export function EndpointSearch({
  roleLabel,
  onPick,
  disabled = false,
  autoFocus = false,
}: EndpointSearchProps) {
  const { searchIndex, getPlace, directory } = useAtlas();
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const options = useMemo<Option[]>(() => {
    if (!query.trim()) return [];
    const out: Option[] = [];
    for (const hit of searchIndex.search(query, { kinds: ['place'], limit: LIMIT })) {
      const place = getPlace(hit.doc.ref);
      if (!place) continue;
      out.push({
        id: `${listId}-${out.length}`,
        place,
        subtitle: hit.doc.subtitle,
        endpoint: placeEndpoint(place),
        blocked: routeBlockReason(place, directory),
      });
    }
    return out;
  }, [query, searchIndex, getPlace, directory, listId]);

  const open = query.trim().length > 0;
  const active = activeIndex >= 0 ? options[activeIndex] : undefined;

  const choose = (o: Option | undefined) => {
    if (!o || o.blocked || !o.endpoint) return;
    onPick(o.endpoint);
    setQuery('');
    setActiveIndex(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = options.length;
    if (e.key === 'ArrowDown' && n > 0) {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % n);
    } else if (e.key === 'ArrowUp' && n > 0) {
      e.preventDefault();
      setActiveIndex((i) => (i <= 0 ? n - 1 : i - 1));
    } else if (e.key === 'Enter' && active) {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape' && query) {
      e.preventDefault();
      e.stopPropagation();
      setQuery('');
      setActiveIndex(-1);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <TextInput
        ref={inputRef}
        label={`Search for the ${roleLabel}`}
        hideLabel
        placeholder={`Search a place for the ${roleLabel}`}
        icon="search"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={active?.id}
        autoComplete="off"
        spellCheck={false}
        value={query}
        disabled={disabled}
        onChange={(e) => {
          setQuery(e.target.value);
          setActiveIndex(-1);
        }}
        onKeyDown={onKeyDown}
        onClear={() => setQuery('')}
        clearLabel="Clear search"
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={`Places for the ${roleLabel}`}
        hidden={!open}
        className="flex max-h-72 flex-col overflow-y-auto rounded-md border border-border bg-surface-raised"
      >
        {options.map((o, i) => (
          <li
            key={o.place.id}
            id={o.id}
            role="option"
            aria-selected={i === activeIndex}
            aria-disabled={o.blocked !== null || undefined}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(o)}
            className={cx(
              'flex min-h-11 cursor-pointer flex-col justify-center gap-0.5 border-b border-border px-3 py-2 last:border-b-0',
              i === activeIndex && 'bg-surface-hover',
              o.blocked ? 'cursor-not-allowed' : 'hover:bg-surface-hover',
            )}
          >
            <span className={cx('text-sm font-medium', o.blocked ? 'text-muted' : 'text-text')}>
              {o.place.displayName}
            </span>
            {o.subtitle ? <span className="text-xs text-muted">{o.subtitle}</span> : null}
            {o.blocked ? (
              <span className="flex items-center gap-1 text-xs text-muted">
                <Icon name="info" size={14} />
                Can't route here: {o.blocked}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {open && options.length === 0 ? (
        <p className="px-1 text-sm text-muted">No matching places in the map data.</p>
      ) : null}
      <span className="sr-only" aria-live="polite">
        {open ? `${options.length} ${options.length === 1 ? 'place' : 'places'} found` : ''}
      </span>
    </div>
  );
}
