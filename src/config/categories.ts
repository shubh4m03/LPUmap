/**
 * Central, extensible category registry. Pipeline (scripts/) and UI both read
 * this — never hardcode category ids, labels or colours elsewhere.
 *
 * `osm` lists the tag matchers the pipeline uses to classify features. A
 * category may legitimately have zero records in the current dataset; the UI
 * then shows an honest empty state rather than invented places.
 */

export interface OsmMatcher {
  key: string;
  /** Omit to match any value of `key`. */
  values?: string[];
}

export interface CategoryDef {
  id: string;
  label: string;
  /** Short plural used in "Nearest …" actions. */
  noun: string;
  /** Layer group shown in the layer panel. */
  group: LayerGroupId;
  /** Accent colour token (CSS colour) for markers/legend; must pass 3:1 on map surfaces. */
  color: string;
  /** Single glyph from the icon set in src/components/icons. */
  icon: string;
  synonyms: string[];
  osm: OsmMatcher[];
  /** Offer in "Nearest …" quick actions. */
  nearestAction?: boolean;
}

export const LAYER_GROUPS = [
  { id: 'academic', label: 'Academic buildings' },
  { id: 'residential', label: 'Hostels & residences' },
  { id: 'food', label: 'Food & mess' },
  { id: 'study', label: 'Libraries & study' },
  { id: 'health', label: 'Health & emergency' },
  { id: 'finance', label: 'ATMs & banks' },
  { id: 'printing', label: 'Printing & stationery' },
  { id: 'water', label: 'Water & washrooms' },
  { id: 'sports', label: 'Sports & recreation' },
  { id: 'transport', label: 'Transport & parking' },
  { id: 'access', label: 'Gates & step-free features' },
  { id: 'services', label: 'Shops & other services' },
] as const;

export type LayerGroupId = (typeof LAYER_GROUPS)[number]['id'];

export const CATEGORIES: readonly CategoryDef[] = [
  {
    id: 'university',
    label: 'University campus',
    noun: 'campus areas',
    group: 'academic',
    color: '#c2410c',
    icon: 'school',
    synonyms: ['campus', 'university', 'lpu'],
    osm: [{ key: 'amenity', values: ['university', 'college'] }],
  },
  {
    id: 'academic',
    label: 'Academic building',
    noun: 'academic buildings',
    group: 'academic',
    color: '#c2410c',
    icon: 'school',
    synonyms: ['block', 'department', 'school', 'institute', 'faculty', 'classroom', 'lecture'],
    osm: [
      { key: 'building', values: ['university', 'college', 'school'] },
      { key: 'office', values: ['educational_institution'] },
    ],
  },
  {
    id: 'hostel',
    label: 'Hostel',
    noun: 'hostels',
    group: 'residential',
    color: '#7c3aed',
    icon: 'bed',
    synonyms: ['hostel', 'boys hostel', 'girls hostel', 'bh', 'gh', 'dorm', 'residence hall'],
    osm: [
      { key: 'tourism', values: ['hostel'] },
      { key: 'building', values: ['dormitory'] },
    ],
  },
  {
    id: 'residential',
    label: 'Residence / PG / apartment',
    noun: 'residences',
    group: 'residential',
    color: '#8b5cf6',
    icon: 'home',
    synonyms: ['pg', 'paying guest', 'apartment', 'flat', 'rooms', 'residency', 'villa'],
    osm: [
      { key: 'tourism', values: ['apartment', 'guest_house', 'hotel', 'motel'] },
      { key: 'building', values: ['apartments', 'residential', 'house'] },
    ],
  },
  {
    id: 'food',
    label: 'Food & drink',
    noun: 'food outlets',
    group: 'food',
    color: '#dc2626',
    icon: 'utensils',
    synonyms: ['food', 'eat', 'restaurant', 'cafe', 'canteen', 'dhaba', 'snacks', 'coffee', 'mess', 'bakery'],
    osm: [
      { key: 'amenity', values: ['restaurant', 'cafe', 'fast_food', 'food_court', 'canteen', 'ice_cream'] },
      { key: 'shop', values: ['bakery', 'confectionery', 'dairy'] },
    ],
    nearestAction: true,
  },
  {
    id: 'library',
    label: 'Library & study',
    noun: 'libraries',
    group: 'study',
    color: '#0369a1',
    icon: 'book',
    synonyms: ['library', 'study', 'reading room', 'books'],
    osm: [{ key: 'amenity', values: ['library', 'studio'] }],
  },
  {
    id: 'health',
    label: 'Health & emergency',
    noun: 'health facilities',
    group: 'health',
    color: '#be123c',
    icon: 'cross',
    synonyms: [
      'hospital',
      'clinic',
      'doctor',
      'medical',
      'pharmacy',
      'chemist',
      'health',
      'first aid',
      'emergency',
    ],
    osm: [
      { key: 'amenity', values: ['hospital', 'clinic', 'doctors', 'pharmacy', 'dentist'] },
      { key: 'healthcare' },
      { key: 'shop', values: ['chemist', 'medical_supply'] },
      { key: 'emergency', values: ['defibrillator', 'first_aid_kit', 'assembly_point'] },
    ],
    nearestAction: true,
  },
  {
    id: 'finance',
    label: 'ATM & bank',
    noun: 'ATMs and banks',
    group: 'finance',
    color: '#15803d',
    icon: 'banknote',
    synonyms: ['atm', 'bank', 'cash', 'money'],
    osm: [{ key: 'amenity', values: ['atm', 'bank', 'bureau_de_change'] }],
    nearestAction: true,
  },
  {
    id: 'printing',
    label: 'Printing & stationery',
    noun: 'printing shops',
    group: 'printing',
    color: '#0f766e',
    icon: 'printer',
    synonyms: ['print', 'printout', 'xerox', 'photocopy', 'stationery', 'copy'],
    osm: [
      { key: 'shop', values: ['copyshop', 'stationery'] },
      { key: 'craft', values: ['printer'] },
    ],
    nearestAction: true,
  },
  {
    id: 'water',
    label: 'Drinking water',
    noun: 'drinking-water points',
    group: 'water',
    color: '#0284c7',
    icon: 'droplet',
    synonyms: ['water', 'cooler', 'drinking water', 'water cooler', 'ro'],
    osm: [{ key: 'amenity', values: ['drinking_water', 'water_point'] }],
    nearestAction: true,
  },
  {
    id: 'washroom',
    label: 'Washroom',
    noun: 'washrooms',
    group: 'water',
    color: '#0891b2',
    icon: 'restroom',
    synonyms: ['washroom', 'toilet', 'restroom', 'loo', 'bathroom'],
    osm: [{ key: 'amenity', values: ['toilets'] }],
    nearestAction: true,
  },
  {
    id: 'laundry',
    label: 'Laundry',
    noun: 'laundries',
    group: 'services',
    color: '#4f46e5',
    icon: 'shirt',
    synonyms: ['laundry', 'dhobi', 'washing', 'dry clean'],
    osm: [{ key: 'shop', values: ['laundry', 'dry_cleaning'] }],
  },
  {
    id: 'sports',
    label: 'Sports & fitness',
    noun: 'sports facilities',
    group: 'sports',
    color: '#65a30d',
    icon: 'ball',
    synonyms: [
      'sports',
      'ground',
      'gym',
      'fitness',
      'court',
      'stadium',
      'pitch',
      'pool',
      'cricket',
      'football',
    ],
    osm: [
      {
        key: 'leisure',
        values: ['pitch', 'sports_centre', 'stadium', 'fitness_centre', 'swimming_pool', 'track'],
      },
    ],
  },
  {
    id: 'park',
    label: 'Park & green space',
    noun: 'parks',
    group: 'sports',
    color: '#16a34a',
    icon: 'tree',
    synonyms: ['park', 'garden', 'lawn', 'green'],
    osm: [{ key: 'leisure', values: ['park', 'garden'] }],
  },
  {
    id: 'transport',
    label: 'Transport',
    noun: 'transport points',
    group: 'transport',
    color: '#ca8a04',
    icon: 'bus',
    synonyms: ['bus', 'bus stop', 'auto', 'taxi', 'rickshaw', 'station', 'transport', 'cab'],
    osm: [
      { key: 'amenity', values: ['bus_station', 'taxi', 'bicycle_rental'] },
      { key: 'highway', values: ['bus_stop'] },
      { key: 'public_transport' },
    ],
  },
  {
    id: 'parking',
    label: 'Parking',
    noun: 'parking areas',
    group: 'transport',
    color: '#a16207',
    icon: 'parking',
    synonyms: ['parking', 'car park', 'bike stand', 'cycle stand'],
    osm: [{ key: 'amenity', values: ['parking', 'bicycle_parking', 'motorcycle_parking'] }],
  },
  {
    id: 'gate',
    label: 'Gate & entrance',
    noun: 'gates and exits',
    group: 'access',
    color: '#9a3412',
    icon: 'gate',
    synonyms: ['gate', 'entrance', 'exit', 'entry', 'main gate'],
    osm: [{ key: 'barrier', values: ['gate', 'lift_gate', 'entrance'] }, { key: 'entrance' }],
    nearestAction: true,
  },
  {
    id: 'shop',
    label: 'Shop & service',
    noun: 'shops',
    group: 'services',
    color: '#475569',
    icon: 'bag',
    synonyms: ['shop', 'store', 'mart', 'grocery', 'mobile', 'repair', 'salon', 'barber'],
    osm: [{ key: 'shop' }, { key: 'amenity', values: ['marketplace', 'post_office'] }, { key: 'craft' }],
  },
  {
    id: 'worship',
    label: 'Place of worship',
    noun: 'places of worship',
    group: 'services',
    color: '#9333ea',
    icon: 'star',
    synonyms: ['temple', 'gurudwara', 'mosque', 'church', 'worship'],
    osm: [{ key: 'amenity', values: ['place_of_worship'] }],
  },
  {
    id: 'building',
    label: 'Building (use not recorded)',
    noun: 'buildings',
    group: 'academic',
    color: '#64748b',
    icon: 'building',
    synonyms: ['building'],
    osm: [{ key: 'building' }],
  },
  {
    id: 'other',
    label: 'Other mapped place',
    noun: 'places',
    group: 'services',
    color: '#64748b',
    icon: 'pin',
    synonyms: [],
    osm: [],
  },
];

const byId = new Map(CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: string): CategoryDef {
  return byId.get(id) ?? byId.get('other')!;
}

export function categoriesInGroup(group: LayerGroupId): CategoryDef[] {
  return CATEGORIES.filter((c) => c.group === group);
}
