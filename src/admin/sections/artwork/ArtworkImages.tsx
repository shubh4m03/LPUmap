/**
 * The owner's artwork, shown UNCHANGED: the published originals
 * (public/isometric-art/original/…, byte-identical to the owner's files) at
 * their own aspect ratio, never recoloured, stretched or cropped. Hotspot
 * outlines are drawn over the master in ONE SVG whose viewBox is the source
 * pixel space (manifest coordinateSpace): the image sits at (0, 0, width,
 * height) and the outlines at normalized × size, so a single uniform
 * viewBox→viewport transform places both. The zoomed view only narrows the
 * viewBox (the same transform, a different window); nothing is cut from the file.
 */
import { prepareHotspots, svgPoints, unionBBox } from '../../../isometric-art/hotspot-geometry.ts';
import { artworkUrl } from '../../../isometric-art/manifest-loader.ts';
import type { IsometricArtManifest } from '../../../isometric-art/schema.ts';
import { displayAsset, masterAsset, zoomViewBox, type ViewBox } from './artwork-images.ts';

const vb = (b: ViewBox) => `${b.x} ${b.y} ${b.width} ${b.height}`;

export function MasterHotspotPreview({
  manifest,
  hotspotIds,
  zoom = false,
  label,
}: {
  manifest: IsometricArtManifest;
  hotspotIds: readonly string[];
  zoom?: boolean;
  label: string;
}) {
  const master = masterAsset(manifest);
  const space = { width: manifest.coordinateSpace.width, height: manifest.coordinateSpace.height };
  if (!master?.original) return <p className="text-sm text-muted">The overview image is not published.</p>;
  const wanted = new Set(hotspotIds);
  const hotspots = manifest.hotspots.filter((h) => wanted.has(h.hotspotId));
  const prepared = prepareHotspots(hotspots, space);
  const box = unionBBox(prepared);
  const view: ViewBox = zoom && box ? zoomViewBox(box, space) : { x: 0, y: 0, ...space };
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={vb(view)}
      preserveAspectRatio="xMidYMid meet"
      className="block h-auto w-full rounded-md border border-border bg-surface-sunken"
      data-testid={zoom ? 'artwork-hotspot-zoom' : 'artwork-hotspot-overview'}
      data-viewbox={vb(view)}
    >
      <image
        href={artworkUrl(master.original.url)}
        x={0}
        y={0}
        width={space.width}
        height={space.height}
        preserveAspectRatio="xMidYMid meet"
        data-testid="artwork-master-image"
      />
      {prepared.map((p, i) => {
        const review = hotspots[i]!.reviewStatus === 'needs-manual-verification';
        return (
          <polygon
            key={p.hotspotId}
            points={svgPoints(p.ring)}
            data-hotspot-id={p.hotspotId}
            data-review-status={hotspots[i]!.reviewStatus}
            fill="rgba(37, 99, 235, 0.18)"
            stroke={review ? '#b45309' : '#1d4ed8'}
            strokeWidth={zoom ? 3 : 2.5}
            strokeDasharray={review ? '8 6' : undefined}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
}

/** An original vignette (or any asset) as published: natural aspect ratio, no filter, no crop. */
export function OriginalImage({
  manifest,
  assetId,
  className,
  lazy = false,
}: {
  manifest: IsometricArtManifest;
  assetId: string;
  className?: string;
  lazy?: boolean;
}) {
  const a = displayAsset(manifest, assetId);
  if (!a?.original) return <p className="text-sm text-muted">{assetId}: not published.</p>;
  const file = a.original.url.split('/').pop() ?? a.original.url;
  return (
    <figure className={className}>
      <img
        src={artworkUrl(a.original.url)}
        width={a.source.width}
        height={a.source.height}
        alt={`Original artwork ${a.assetId} (${file}), shown unchanged`}
        loading={lazy ? 'lazy' : 'eager'}
        decoding="async"
        className="block h-auto w-full max-w-full rounded-md border border-border bg-surface-sunken"
        data-testid="artwork-original-image"
        data-asset-id={a.assetId}
      />
      <figcaption className="mt-1 text-xs text-muted">
        <code>{assetId}</code>
        {assetId !== a.assetId ? (
          <>
            {' '}
            (byte-identical duplicate of <code>{a.assetId}</code>)
          </>
        ) : null}{' '}
        · {file} · {a.source.width}×{a.source.height} · original, unchanged
      </figcaption>
    </figure>
  );
}
