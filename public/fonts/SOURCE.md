# Self-hosted map glyphs

MapLibre renders map labels from signed-distance-field (SDF) glyph ranges in
PBF format. They are served from this directory (`/fonts/{fontstack}/{range}.pbf`,
prefixed with Vite's `BASE_URL`) so the app makes **no runtime requests to a
third-party font CDN**.

## Files

| Fontstack           | Ranges                          | Covers                                                                              |
| ------------------- | ------------------------------- | ----------------------------------------------------------------------------------- |
| `Noto Sans Regular` | `0-255`, `256-511`, `8192-8447` | Basic Latin + Latin-1, Latin Extended-A/B, general punctuation (`·`, `–`, `—`, `…`) |
| `Noto Sans Bold`    | `0-255`, `256-511`, `8192-8447` | same, bold weight                                                                   |

Any character outside these ranges (e.g. Gurmukhi or Devanagari in an OSM
name) has no glyph file here; MapLibre then requests a range that 404s and
renders that character as blank (the map does not report this as an error).
Map labels come from OSM `name` tags; this coverage has not yet been checked
against the generated dataset, so non-Latin names would show blank characters
until the matching ranges are added here.

## Source

Downloaded 2026-10-23 from the MapLibre project's demo-tiles font server, which
publishes glyph PBFs generated from Noto Sans (the stacks are combined builds
whose internal name also lists Noto fallbacks):

- https://demotiles.maplibre.org/font/Noto%20Sans%20Regular/0-255.pbf
- https://demotiles.maplibre.org/font/Noto%20Sans%20Regular/256-511.pbf
- https://demotiles.maplibre.org/font/Noto%20Sans%20Regular/8192-8447.pbf
- https://demotiles.maplibre.org/font/Noto%20Sans%20Bold/0-255.pbf
- https://demotiles.maplibre.org/font/Noto%20Sans%20Bold/256-511.pbf
- https://demotiles.maplibre.org/font/Noto%20Sans%20Bold/8192-8447.pbf

The `openmaptiles/fonts` `gh-pages` branch was tried first and returned 404
for these paths on the download date.

SHA-256 at download time:

```
ef1f38a3f1978591e846e9eaddf8a54f7047f546fc6aaed7872cc53151a5de78  Noto Sans Regular/0-255.pbf
992557f9e2574cfb9a75e16c7b52832578849772b7c9a6e480d6213fb008fe5d  Noto Sans Regular/256-511.pbf
f061e5b4e42e5925228534d8822b423a029569263db09f5ce44573600d45295f  Noto Sans Regular/8192-8447.pbf
f60ce4cb899455c2203bd8293b550394ade53ffce8032bf9cc7f59255e49259c  Noto Sans Bold/0-255.pbf
77c830f114b84a58f8829ca1eac4627a6a688bbce4bdb6a04de00f98fa74bb52  Noto Sans Bold/256-511.pbf
f31c3c9dcacbd7f9760462c0af5017d9c9f2a9543ab4938476f7a13ffabf0acf  Noto Sans Bold/8192-8447.pbf
```

## License

Noto Sans is © The Noto Project Authors, licensed under the SIL Open Font
License 1.1 — see `LICENSE.txt` (text from
https://github.com/notofonts/latin-greek-cyrillic/blob/main/OFL.txt).
