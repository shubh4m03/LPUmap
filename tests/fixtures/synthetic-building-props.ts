/**
 * Builds a schema-valid v2 BuildingProps object for synthetic (invented) test
 * buildings. Defaults describe an unnamed, fully inside, OSM-imported
 * footprint with a placeholder render height; override what a test needs.
 * The fidelity level follows renderHeightSource unless overridden.
 */
import type { BuildingProps, HeightSource } from '../../src/data/schema.ts';

const FIDELITY: Record<HeightSource, 0 | 1 | 2> = { fallback: 0, 'osm-levels-estimate': 1, 'osm-height': 2 };

export function syntheticBuildingProps(over: Partial<BuildingProps> & { id: string }): BuildingProps {
  const renderHeightSource = over.renderHeightSource ?? 'fallback';
  const levels = over.levels ?? (renderHeightSource === 'osm-levels-estimate' ? 3 : null);
  return {
    name: null,
    displayName: 'Unnamed building',
    categoryId: 'building',
    geometrySource: 'osm',
    sourceId: 'osm',
    sourceRef: over.id.replace(/^osm:/, ''),
    retrievedAt: '2026-10-23T09:39:00Z',
    verificationStatus: 'imported',
    lastVerifiedAt: null,
    campusStatus: 'inside',
    inCampusInventory: true,
    insideFraction: 1,
    distanceToBoundaryM: 10,
    membershipMethod: 'polygon-clip',
    membershipReasonCode: 'interior',
    membershipReason: '100 % of the footprint area is inside the boundary.',
    membershipDecision: 'auto',
    membershipDecisionSource: null,
    reviewSectionId: null,
    pointAreaDisagreement: false,
    areaM2: 400,
    anchorLon: 75.7,
    anchorLat: 31.25,
    isBuildingPart: false,
    levels,
    levelsSource: levels === null ? null : 'osm-building-levels',
    minLevel: null,
    osmHeightM: renderHeightSource === 'osm-height' ? (over.renderHeightM ?? 12) : null,
    osmMinHeightM: null,
    roofShape: null,
    roofMaterial: null,
    roofColour: null,
    roofLevels: null,
    buildingMaterial: null,
    buildingColour: null,
    fidelityLevel: FIDELITY[renderHeightSource],
    fidelityReason: 'synthetic test building',
    directoryKey: null,
    directoryCell: null,
    officialBlockLabel: null,
    officialBlockSourceId: null,
    renderHeightM: 6,
    renderMinHeightM: 0,
    renderHeightSource,
    ...over,
  };
}
