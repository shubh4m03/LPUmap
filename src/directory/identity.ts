/**
 * The ONE rule for an "official name" shown anywhere (place details, the
 * illustration's detail card): a place name whose provenance is verified
 * against a cited official source. A map display name ("Unnamed building ·
 * 10 floors", an OSM name) and any artwork label are never official names.
 */
export function verifiedOfficialName(place: {
  name: string | null;
  provenance: { verificationStatus: string };
}): string | null {
  return place.name !== null && place.provenance.verificationStatus === 'verified' ? place.name : null;
}
