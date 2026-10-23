/**
 * Evaluates style expressions and filters with MapLibre's own style-spec
 * engine (the package maplibre-gl itself depends on), so tests check what the
 * renderer will actually compute rather than the shape of the JSON.
 */
import { expression, featureFilter, latest } from '@maplibre/maplibre-gl-style-spec';
import type { FilterSpecification, LayerSpecification } from 'maplibre-gl';

const GEOMETRY_TYPE = { Point: 1, LineString: 2, Polygon: 3 } as const;

export interface EvalFeature {
  properties?: Record<string, unknown>;
  geometryType?: keyof typeof GEOMETRY_TYPE;
  state?: Record<string, unknown>;
  zoom?: number;
}

function toFeature(f: EvalFeature) {
  return { type: GEOMETRY_TYPE[f.geometryType ?? 'Point'], properties: f.properties ?? {} } as never;
}

export function evalFilter(filter: FilterSpecification | undefined, f: EvalFeature): boolean {
  return featureFilter(filter, 'test').filter({ zoom: f.zoom ?? 17 } as never, toFeature(f));
}

export function evalProperty(
  layer: LayerSpecification,
  group: 'paint' | 'layout',
  name: string,
  f: EvalFeature = {},
): unknown {
  const value = (layer[group as keyof LayerSpecification] as Record<string, unknown> | undefined)?.[name];
  const specs = latest as unknown as Record<string, Record<string, unknown>>;
  const spec = specs[`${group}_${layer.type}`]?.[name];
  if (!spec) throw new Error(`Unknown property ${group}.${name} for ${layer.type}`);
  const parsed = expression.createPropertyExpression(value, name, spec as never);
  if (parsed.result !== 'success')
    throw new Error(`Invalid expression for ${name}: ${JSON.stringify(parsed.value)}`);
  const out: unknown = parsed.value.evaluate(
    { zoom: f.zoom ?? 17 } as never,
    toFeature(f),
    (f.state ?? {}) as never,
  );
  return out;
}

/** Colour results come back as style-spec Color objects; normalise to #rrggbb. */
export function toHex(c: unknown): string {
  const { r, g, b } = c as { r: number; g: number; b: number; a: number };
  const h = (v: number) =>
    Math.round(v * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}
