import { useId } from 'react';
import { ResultRow } from '../ui/index.ts';
import type { PaletteItem, PaletteSection } from './palette-model.ts';

export interface PaletteListProps {
  id: string;
  label: string;
  sections: readonly PaletteSection[];
  activeIndex: number;
  optionId(index: number): string;
  onHover(index: number): void;
  onSelect(item: PaletteItem): void;
}

/** Listbox of grouped options; focus stays in the combobox (aria-activedescendant). */
export function PaletteList({
  id,
  label,
  sections,
  activeIndex,
  optionId,
  onHover,
  onSelect,
}: PaletteListProps) {
  const baseId = useId();
  const starts = sections.map((_, si) => sections.slice(0, si).reduce((n, s) => n + s.items.length, 0));
  return (
    <div id={id} role="listbox" aria-label={label} className="-mx-5 flex flex-col">
      {sections.map((section, si) => {
        const headingId = `${baseId}-${section.id}`;
        return (
          <div key={section.id} role="group" aria-labelledby={headingId} className="pb-2">
            <div
              id={headingId}
              role="presentation"
              className="px-5 pt-1 pb-1 text-xs font-semibold tracking-wide text-subtle uppercase"
            >
              {section.label}
            </div>
            {section.items.map((item, ii) => {
              const i = (starts[si] ?? 0) + ii;
              return (
                <div key={item.key} onMouseMove={() => i !== activeIndex && onHover(i)}>
                  <ResultRow
                    as="option"
                    id={optionId(i)}
                    active={i === activeIndex}
                    title={item.title}
                    {...(item.segments ? { segments: item.segments } : {})}
                    subtitle={item.subtitle}
                    icon={item.icon}
                    {...(item.iconColor ? { iconColor: item.iconColor } : {})}
                    onSelect={() => onSelect(item)}
                    className="px-5"
                  />
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
