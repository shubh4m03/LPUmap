// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  decodeXmlEntities,
  mergeOsmData,
  OsmParseError,
  parseOsm,
  parseOsmXml,
  parseOverpassJson,
} from '../../../scripts/lib/osm-parse.ts';

const XML = `<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6" generator="test">
 <bounds minlat="31.0" minlon="75.0" maxlat="31.1" maxlon="75.1"/>
 <node id="1" visible="true" lat="31.0500000" lon="75.0500000"/>
 <node id="2" lat='31.06' lon='75.06'>
  <tag k="name" v="Caf&#233; &amp; &quot;Mess&quot; &lt;1&gt;"/>
  <tag k="amenity" v="cafe"/>
 </node>
 <node id="3" visible="false" lat="31.07" lon="75.07"/>
 <way id="10">
  <nd ref="1"/>
  <nd ref="2"/>
  <tag k="highway" v="footway"/>
 </way>
 <relation id="100">
  <member type="way" ref="10" role="outer"/>
  <member type="node" ref="2" role=""/>
  <tag k="type" v="multipolygon"/>
 </relation>
</osm>`;

describe('parseOsmXml', () => {
  it('reads nodes, ways, relations and tags with entity decoding', () => {
    const d = parseOsmXml(XML);
    expect(d.nodes.get(1)).toEqual({ type: 'node', id: 1, lon: 75.05, lat: 31.05, tags: {} });
    expect(d.nodes.get(2)?.tags).toEqual({ name: 'Café & "Mess" <1>', amenity: 'cafe' });
    expect(d.ways.get(10)).toEqual({ type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'footway' } });
    expect(d.relations.get(100)?.members).toEqual([
      { type: 'way', ref: 10, role: 'outer' },
      { type: 'node', ref: 2, role: '' },
    ]);
  });

  it('drops deleted (visible="false") elements', () => {
    expect(parseOsmXml(XML).nodes.has(3)).toBe(false);
  });

  it('rejects non-OSM documents and malformed coordinates', () => {
    expect(() => parseOsmXml('<html></html>')).toThrow(OsmParseError);
    expect(() => parseOsmXml('<osm><node id="1" lat="x" lon="75"/></osm>')).toThrow(/Invalid lat/);
    expect(() => parseOsmXml('<osm><node id="abc" lat="1" lon="2"/></osm>')).toThrow(/Invalid node id/);
  });

  it('keeps an unescaped ">" inside a quoted attribute value (legal XML)', () => {
    const d = parseOsmXml(
      `<osm><node id="7" lat="31" lon="75"><tag k="note" v="gate > 9pm closed"/><tag k='a' v='b/>c'/></node></osm>`,
    );
    expect(d.nodes.get(7)?.tags).toEqual({ note: 'gate > 9pm closed', a: 'b/>c' });
  });

  it('rejects an unterminated element instead of silently dropping it', () => {
    expect(() => parseOsmXml('<osm><way id="5"><nd ref="1"/></osm>')).toThrow(/Unterminated/);
  });
});

describe('parseOverpassJson', () => {
  it('reads elements and ignores non-string tags', () => {
    const d = parseOverpassJson({
      elements: [
        { type: 'node', id: 1, lat: 31, lon: 75, tags: { name: 'A', bogus: 5 } },
        { type: 'way', id: 2, nodes: [1, 1], tags: {} },
        { type: 'relation', id: 3, members: [{ type: 'way', ref: 2, role: 'outer' }] },
      ],
    });
    expect(d.nodes.get(1)?.tags).toEqual({ name: 'A' });
    expect(d.ways.get(2)?.nodes).toEqual([1, 1]);
    expect(d.relations.get(3)?.members[0]).toEqual({ type: 'way', ref: 2, role: 'outer' });
  });

  it('rejects documents without an elements array and bad member types', () => {
    expect(() => parseOverpassJson({})).toThrow(OsmParseError);
    expect(() =>
      parseOverpassJson({ elements: [{ type: 'relation', id: 1, members: [{ type: 'area', ref: 1 }] }] }),
    ).toThrow(/member type/);
  });
});

describe('parseOsm / mergeOsmData / entities', () => {
  it('detects the format', () => {
    expect(parseOsm(XML).ways.size).toBe(1);
    expect(parseOsm('  {"elements":[]}').nodes.size).toBe(0);
    expect(() => parseOsm('id,lat,lon')).toThrow(OsmParseError);
  });

  it('merges extracts with first-wins semantics', () => {
    const a = parseOverpassJson({ elements: [{ type: 'node', id: 1, lat: 1, lon: 1, tags: { v: 'a' } }] });
    const b = parseOverpassJson({
      elements: [
        { type: 'node', id: 1, lat: 2, lon: 2, tags: { v: 'b' } },
        { type: 'node', id: 2, lat: 3, lon: 3 },
      ],
    });
    const m = mergeOsmData(a, b);
    expect(m.nodes.get(1)?.tags.v).toBe('a');
    expect(m.nodes.size).toBe(2);
  });

  it('decodes numeric and named entities and leaves unknown ones', () => {
    expect(decodeXmlEntities('&#x41;&#66;&apos;&unknown;')).toBe("AB'&unknown;");
  });
});
