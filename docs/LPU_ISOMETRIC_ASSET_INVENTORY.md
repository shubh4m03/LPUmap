# LPU isometric artwork: asset inventory

**Status: final for this integration (2026-10-24), with the owner review items listed under [Needs manual verification](#needs-manual-verification).** This inventory records what the files are and what is printed on them. It links nothing to a building. Verified on 2026-10-24 against the original files at full resolution, using zoomed crops kept in scratch only. OCR was not relied on.

The machine-readable source of truth is [`data/curated/isometric-art/inventory.json`](../data/curated/isometric-art/inventory.json), validated by `scripts/lib/art-inventory-check.ts` (unit test and `npm run art:check`). This page was generated once from it and is maintained by hand; no check compares the two. If they ever disagree, the JSON wins and this page must be updated.

How the files are used: [LPU_ISOMETRIC_ASSET_INTEGRATION.md](LPU_ISOMETRIC_ASSET_INTEGRATION.md) (pipeline, renderer, admin, owner verification guide). Which building each depicted item may be: [LPU_ISOMETRIC_ASSET_MAPPING.md](LPU_ISOMETRIC_ASSET_MAPPING.md) (generated). Clickable outlines on the master: `data/curated/isometric-art/hotspots.json` (65 outlines in normalized source coordinates).

## What this artwork is and is not

- The owner supplied the 29 files in `lpu-isometric-map-design/` on 2026-10-24, stating: "I own or am authorized to use the artwork" (recorded in [GEODATA_SOURCES_AND_LICENSES.md §14](GEODATA_SOURCES_AND_LICENSES.md#14-lpu-isometric-map-design-owner-supplied-campus-illustration)). The master JPEG's XMP names Adobe Illustrator CS6 and a creation date of 2019-04-25.
- It is the authoritative **visual** source for the illustrated (isometric) mode and is shown as drawn. It is a 2D illustration, not a rotatable 3D model, and it is not geographically exact.
- **Artwork and index numbers are not official LPU block numbers.** Nothing on this page names, numbers or positions a real building on the geographic map. Geographic associations live in `data/curated/isometric-art/registry.json` and the owner's decisions in `/admin/artwork`: today 0 verified, 19 approximate ("Unconfirmed match", never routed) and 63 unresolved of 82 depicted subjects. Only owner or official evidence can make one verified.
- Labels are transcribed **exactly** as printed, typos included (`INGNEERING`, `HOSTAL`, `ARCHITECRURE`, `PEDISTRIAN` and so on). A corrected spelling may only ever be a search alias, kept in separate data.
- The originals are never modified, renamed or re-encoded. Their sha256 values below are checked by a unit test.

## Files

29 files, 28 unique images. One master overview, 20 block vignettes and 8 scene vignettes. `111-…` and `115-…` are byte-identical; `iso-art-111` is the canonical copy.

| Id          | File                                   | Role                                      | Size (px)   | Bytes   | sha256                                                             | Earlier research name |
| ----------- | -------------------------------------- | ----------------------------------------- | ----------- | ------- | ------------------------------------------------------------------ | --------------------- |
| iso-art-001 | `1-lpu-isometric-map-design-3371.jpg`  | master-overview                           | 3371 × 2384 | 5214675 | `41997f42cea0f99e62c5b6b23406afdb3cd8e4bcb4635fa1c264c91127044a25` | slide-28.jpg          |
| iso-art-011 | `11-lpu-isometric-map-design-961.png`  | block-vignette                            | 961 × 540   | 40566   | `cca73014e80c5d992d725e55d8477f481d8963249260f6c5ea209dbe25fb7c06` | slide-29.png          |
| iso-art-015 | `15-lpu-isometric-map-design-963.png`  | block-vignette                            | 963 × 540   | 45846   | `73b7339ac8f74b828e9b28d78c30b91ab6affb388b26e1148ee43ca54cd1d9c5` | slide-30.png          |
| iso-art-019 | `19-lpu-isometric-map-design-961.png`  | block-vignette                            | 961 × 540   | 55442   | `28b078d9f4c2074ceeb279695f67938b60f9ef01b2db39d28bd48a832529e745` | slide-25.png          |
| iso-art-023 | `23-lpu-isometric-map-design-961.png`  | block-vignette                            | 961 × 540   | 46346   | `2f1f2b056e466a710381621ede02941db5b00eec5f8bb90e6c770fcada65c16d` | slide-26.png          |
| iso-art-027 | `27-lpu-isometric-map-design-961.png`  | block-vignette                            | 961 × 540   | 102092  | `2a332863ae6fba9a44ac11a660559fa31363c43c07006a4f59e5588c9f1d2636` | slide-27.png          |
| iso-art-031 | `31-lpu-isometric-map-design-961.png`  | block-vignette                            | 961 × 540   | 90679   | `ccf425a0f411763703b3ec2879ed062b0d27a986639823bf6c68ea0d2b920c72` | slide-22.png          |
| iso-art-035 | `35-lpu-isometric-map-design-961.png`  | block-vignette                            | 961 × 540   | 85288   | `bff5b3b359bb1cac4e72dca6356660582c7be3515f9647bacb211f5fd57c5ecf` | slide-23.png          |
| iso-art-039 | `39-lpu-isometric-map-design-963.png`  | block-vignette                            | 963 × 540   | 58577   | `11c9bc2ad4a85b4a9c125498e2a0ab64ca7b50b01743f68da8be5dc7279e39b2` | slide-24.png          |
| iso-art-043 | `43-lpu-isometric-map-design-961.png`  | block-vignette                            | 961 × 540   | 102106  | `6d1803d48a5a08475a73ce0d68149c798789d0e5fb46779cff5d31cfdee077f3` | slide-19.png          |
| iso-art-047 | `47-lpu-isometric-map-design-961.png`  | block-vignette                            | 961 × 540   | 82149   | `a5e745f8437b06df861b7c4d1df8c2292759e8f9d843a8971bc3b40000f53069` | slide-20.png          |
| iso-art-051 | `51-lpu-isometric-map-design-961.png`  | block-vignette                            | 961 × 540   | 96402   | `958caf11ae7dfae1dc0c7ecdc9f6418a1f7f6b644f5976076ae26b77abc4ff4b` | slide-21.png          |
| iso-art-055 | `55-lpu-isometric-map-design-961.png`  | block-vignette                            | 961 × 540   | 86228   | `2c865a3effbed91b34b89a4ea040ccaf897657d53de3b31583c039560287cf21` | slide-16.png          |
| iso-art-059 | `59-lpu-isometric-map-design-961.png`  | block-vignette                            | 961 × 540   | 95063   | `f3cc654cb2f026dc016c14d50114e8ec4ef4c08a57572f363d21a177597c5798` | slide-17.png          |
| iso-art-063 | `63-lpu-isometric-map-design-963.png`  | block-vignette                            | 963 × 540   | 80531   | `3ee3db53297766fd8abe9836215a1112a6544796e014e3e8f5b524d984eafb06` | slide-18.png          |
| iso-art-067 | `67-lpu-isometric-map-design-961.png`  | block-vignette                            | 961 × 540   | 92567   | `76701f4f3eb7551bfb55a83809808903b123607c3f0420d0a6d2e0c1efda5c85` | slide-13.png          |
| iso-art-071 | `71-lpu-isometric-map-design-961.png`  | block-vignette                            | 961 × 540   | 69839   | `08ee40d540ccbbd0fbf3fb1c4366e8cace78f2eb452a1e15bb163c8d513e834e` | slide-14.png          |
| iso-art-075 | `75-lpu-isometric-map-design-961.png`  | block-vignette                            | 961 × 540   | 78187   | `d7b04fd08938f1473be0a220608731636aee1abedd8f8c925cf90def8131041c` | slide-15.png          |
| iso-art-079 | `79-lpu-isometric-map-design-961.png`  | block-vignette                            | 961 × 540   | 88789   | `039e7fd535428d33d23a13b1d03ff8623efca1b2749c1809722dd85d22d12be7` | slide-10.png          |
| iso-art-083 | `83-lpu-isometric-map-design-961.png`  | block-vignette                            | 961 × 540   | 74628   | `84cbc5030f230fbd7f91f57100224b415abdab285cb692ea278dca6655ace947` | slide-11.png          |
| iso-art-087 | `87-lpu-isometric-map-design-963.png`  | block-vignette                            | 963 × 540   | 171892  | `0cf8b8b754cf50aa41f636f3beeeb45ac04bc52b338990ef93e6e69c7c5c7d7e` | slide-12.png          |
| iso-art-091 | `91-lpu-isometric-map-design-961.png`  | scene-vignette                            | 961 × 540   | 94773   | `732dba5ee46ecc67bb55e05a3ed65318011a52beae73bf220490f45d942d3338` | slide-08.png          |
| iso-art-095 | `95-lpu-isometric-map-design-961.png`  | scene-vignette                            | 961 × 540   | 138762  | `2471ac6bef735305a892d742f04e180933574c0c35000798b5c757b145f2cb66` | slide-09.png          |
| iso-art-099 | `99-lpu-isometric-map-design-961.png`  | scene-vignette                            | 961 × 540   | 153052  | `3952c06ecc358bce1856b4a746b42eed0f28dd1853103ce3e5ea79f2fd93f8db` | slide-07.png          |
| iso-art-103 | `103-lpu-isometric-map-design-961.png` | scene-vignette                            | 961 × 540   | 102294  | `ab5d969fdcb3bcffba01f774b59de47b2acc35187d0145242276692d7f098369` | slide-04.png          |
| iso-art-107 | `107-lpu-isometric-map-design-961.png` | scene-vignette                            | 961 × 541   | 190054  | `2dc2a4837c0b12f204a727fdd5482d828944573be54a82508f50edf07ad7f508` | slide-05.png          |
| iso-art-111 | `111-lpu-isometric-map-design-963.png` | scene-vignette                            | 963 × 541   | 150330  | `b32a8d12c32360a4a0282d71491af0426f11995f77f5e07551f6ab5c462bd5ea` | slide-02.png          |
| iso-art-115 | `115-lpu-isometric-map-design-963.png` | scene-vignette (duplicate of iso-art-111) | 963 × 541   | 150330  | `b32a8d12c32360a4a0282d71491af0426f11995f77f5e07551f6ab5c462bd5ea` | slide-06.png          |
| iso-art-119 | `119-lpu-isometric-map-design-961.png` | scene-vignette                            | 961 × 541   | 179009  | `b24552ae540cd3a31b892eb74fdc6f067ba7d72e93caaa182e21f2c8d6bf5a44` | slide-03.png          |

"Earlier research name" maps each file to the byte-identical screenshot that `docs/research/block-leads/` transcribed as `slide-NN`. Those copies live in the git-ignored `reference/` folder and are never committed.

## Technical findings

- **Master (`iso-art-001`) is a CMYK JPEG.** It is baseline (SOF0), 4 components, with an Adobe APP14 marker (transform 0) and an embedded "U.S. Web Coated (SWOP) v2" ICC profile. Chromium decodes it with the profile, and the contact sheet colours match the original on inspection. Any derived web copy must be converted to sRGB by a colour-managed decoder and compared visually. It must never be re-saved over the original. (Done by `npm run art:derive`: 53 lossless WebP copies under `public/isometric-art/derived/iso-art-001/`, each recording the original's sha256, with native max error 0 against the original as Chromium draws it; see the integration doc §2.)
- **The PNGs are not transparent cut-outs.** They are RGBA (colour type 6, 8-bit, untagged, 72 dpi `pHYs`), but every interior pixel is opaque. Only 1–3 edge columns or rows (slide-export seams) are partly transparent; the exact columns and rows are listed per asset in the JSON. Each PNG is a full presentation slide: light-grey background, peach decorative circles, and the artwork on a white rounded card. The task brief described them as "RGBA, transparent", which is corrected here.
- The JSON records the white card rectangle for every vignette, and the inner scene frame for scene vignettes, in pixels and normalized. The illustration and its outlines can therefore share one transform without cropping away detail.
- `.gitattributes` marked `*.png` as binary but not `*.jpg` when this inventory was taken. The integration owner has since added `*.jpg`, `*.jpeg` and `*.webp` as binary, and `tests/integration/isometric-art-git.test.ts` checks that every artwork image is binary and that git stores it byte for byte.

## Coordinates

All positions are in **source pixels** of the file they belong to: origin top-left, x to the right, y down. Each one is also stored normalized: `nx = x / width`, `ny = y / height`, in [0, 1]. Each asset records its `coordinateSpace` (width and height). Pin positions are the centre of the white pin disc. A disc labels a drawing; it does not mark an exact ground point.

## Labels by asset

Confidence: **high** means legible at 2.5× and exact. **medium** means the words are exact but spacing or punctuation is uncertain. **low** means manual verification is needed. Line breaks are shown as `/`.

### iso-art-011 · block-vignette

`11-lpu-isometric-map-design-961.png`. One brick-red building: stepped cross-shaped roof around a triangular glazed atrium, lower flat-roofed front wing with a teal entrance canopy and steps.

| Label id       | Kind          | Exact text as printed | Confidence |
| -------------- | ------------- | --------------------- | ---------- |
| iso-art-011/L1 | block-heading | `BLOCK-1`             | high       |
| iso-art-011/L2 | caption-name  | `SCHOOL OF FASHION`   | high       |

Caption mapping:

- `BLOCK-1` → numbers 1: `SCHOOL OF FASHION`. single drawn building; caption applies to the whole vignette

### iso-art-015 · block-vignette

`15-lpu-isometric-map-design-963.png`. Long low two-storey bar with an orange/grey facade and a round plinth, terraced steps along one side, joined at one end to a tall grey square tower block.

| Label id       | Kind          | Exact text as printed                          | Confidence                                                                                                                                             |
| -------------- | ------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| iso-art-015/L1 | block-heading | `BLOCK-2`                                      | high                                                                                                                                                   |
| iso-art-015/L2 | caption-name  | `CAMPUS CAFE  &` / `BALDEV RAJ` / `AUDITORIUM` | medium — The gap between "CAFE" and "&" is visibly wider than a normal word space (transcribed as two spaces). Words and spelling are high confidence. |

Caption mapping:

- `BLOCK-2` → numbers 2: `CAMPUS CAFE  & BALDEV RAJ AUDITORIUM`. One caption names two uses. The drawing shows a long low bar with a round plinth plus a tall grey box; which part is the cafe and which the auditorium is NOT stated, so no boundary is recorded.

### iso-art-019 · block-vignette

`19-lpu-isometric-map-design-961.png`. Grey two-part building with splayed walls, dark roof slabs (one with a blue truss edge), a blue glazed corner and an external dog-leg staircase.

| Label id       | Kind          | Exact text as printed                                      | Confidence |
| -------------- | ------------- | ---------------------------------------------------------- | ---------- |
| iso-art-019/L1 | block-heading | `BLOCK-3`                                                  | high       |
| iso-art-019/L2 | caption-name  | `SCHOOL OF` / `PHYSIOTHERAPHY AND` / `PARAMEDICAL SCIENCE` | high       |

Caption mapping:

- `BLOCK-3` → numbers 3: `SCHOOL OF PHYSIOTHERAPHY AND PARAMEDICAL SCIENCE`. single drawn building

### iso-art-023 · block-vignette

`23-lpu-isometric-map-design-961.png`. Grey building whose front is a comb of four projecting window bays, with a wider plain wing at one end.

| Label id       | Kind          | Exact text as printed                       | Confidence |
| -------------- | ------------- | ------------------------------------------- | ---------- |
| iso-art-023/L1 | block-heading | `BLOCK-4`                                   | high       |
| iso-art-023/L2 | caption-name  | `SCHOOL OF` / `PHARAMACEUTICAL` / `SCIENCE` | high       |

Caption mapping:

- `BLOCK-4` → numbers 4: `SCHOOL OF PHARAMACEUTICAL SCIENCE`. single drawn building

### iso-art-027 · block-vignette

`27-lpu-isometric-map-design-961.png`. One connected brick-red complex of several wings and heights with three numbered pins.

| Label id       | Kind          | Exact text as printed                                                                                          | Confidence |
| -------------- | ------------- | -------------------------------------------------------------------------------------------------------------- | ---------- |
| iso-art-027/L1 | block-heading | `BLOCK-6`                                                                                                      | high       |
| iso-art-027/L2 | caption-name  | `SCHOOL OF ARCHITECRURE &` / `PLANING` / `DIVISION OF CONSTRUCTIONS` / `DIVISION OF ARCHITECTURE &` / `DESIGN` | high       |
| iso-art-027/L3 | block-heading | `BLOCK-7`                                                                                                      | high       |
| iso-art-027/L4 | caption-name  | `DEPARTMENT OF` / `PHARMACEUTICAL SCIENCE`                                                                     | high       |
| iso-art-027/L5 | block-heading | `BLOCK-8`                                                                                                      | high       |
| iso-art-027/L6 | caption-name  | `SCHOOL OF FINE ARTS AND` / `SCHOOL OF DESIGN (MULTIMEDIA)`                                                    | high       |

Caption mapping:

- `BLOCK-6` → numbers 6: `SCHOOL OF ARCHITECRURE & PLANING DIVISION OF CONSTRUCTIONS DIVISION OF ARCHITECTURE & DESIGN`. heading number matches the white pin "6" drawn on the mass
- `BLOCK-7` → numbers 7: `DEPARTMENT OF PHARMACEUTICAL SCIENCE`. heading number matches pin "7"
- `BLOCK-8` → numbers 8: `SCHOOL OF FINE ARTS AND SCHOOL OF DESIGN (MULTIMEDIA)`. heading number matches pin "8"

Boundaries: Pins 6, 7 and 8 sit on one connected brick-red mass; the drawing does not mark where one block ends and the next begins.

Pins (x, y px): **8** (327, 133), **7** (410, 268), **6** (170, 305).

### iso-art-031 · block-vignette

`31-lpu-isometric-map-design-961.png`. Four brick-red residential buildings (pins 9, 10, 11, 12) with linking low blocks.

| Label id       | Kind          | Exact text as printed     | Confidence |
| -------------- | ------------- | ------------------------- | ---------- |
| iso-art-031/L1 | block-heading | `BLOCK- 09,10, 11,12`     | high       |
| iso-art-031/L2 | caption-name  | `GIRLS HOSTAL 1, 2, 3, 4` | high       |

Caption mapping:

- `BLOCK- 09,10, 11,12` → numbers 9, 10, 11, 12: `GIRLS HOSTAL 1, 2, 3, 4`. LISTING ORDER ONLY: the caption lists four block numbers and four hostel numbers in parallel; the pairing 9-1, 10-2, 11-3, 12-4 is implied by order and is NOT stated.

Boundaries: Four pinned buildings, partly linked by small connector blocks; boundaries between linked parts are not marked.

Pins (x, y px): **11** (363, 155), **10** (419, 231), **12** (197, 267), **9** (293, 334).

### iso-art-035 · block-vignette

`35-lpu-isometric-map-design-961.png`. Square brick-red building around an open central courtyard, with a stepped black entrance plinth.

| Label id       | Kind          | Exact text as printed             | Confidence |
| -------------- | ------------- | --------------------------------- | ---------- |
| iso-art-035/L1 | block-heading | `BLOCK-13`                        | high       |
| iso-art-035/L2 | caption-name  | `DIVISION OF STUDENT` / `WELFARE` | high       |

Caption mapping:

- `BLOCK-13` → numbers 13: `DIVISION OF STUDENT WELFARE`. single drawn building

### iso-art-039 · block-vignette

`39-lpu-isometric-map-design-963.png`. Brick-red block with a sawtooth roof edge, vertical fins on the end wall and an entrance canopy on teal columns.

| Label id       | Kind          | Exact text as printed       | Confidence |
| -------------- | ------------- | --------------------------- | ---------- |
| iso-art-039/L1 | block-heading | `BLOCK-14`                  | high       |
| iso-art-039/L2 | caption-name  | `MITTAL SCHOOL OF BUSINESS` | high       |

Caption mapping:

- `BLOCK-14` → numbers 14: `MITTAL SCHOOL OF BUSINESS`. single drawn building

### iso-art-043 · block-vignette

`43-lpu-isometric-map-design-961.png`. Tall wedge-shaped building rising to one end, with a blue-glazed curved front and an entrance canopy.

| Label id       | Kind          | Exact text as printed                                          | Confidence |
| -------------- | ------------- | -------------------------------------------------------------- | ---------- |
| iso-art-043/L1 | block-heading | `BLOCK-15`                                                     | high       |
| iso-art-043/L2 | caption-name  | `UNI-CENTER,` / `SCHOOL OF` / `HOTAL MANGMENT AND` / `TOURISM` | high       |

Caption mapping:

- `BLOCK-15` → numbers 15: `UNI-CENTER, SCHOOL OF HOTAL MANGMENT AND TOURISM`. single drawn building; caption names two uses

### iso-art-047 · block-vignette

`47-lpu-isometric-map-design-961.png`. H-shaped brick-red building: two blue-glazed end blocks joined by an open-frame central bridge.

| Label id       | Kind          | Exact text as printed                                                                                        | Confidence |
| -------------- | ------------- | ------------------------------------------------------------------------------------------------------------ | ---------- |
| iso-art-047/L1 | block-heading | `BLOCK-18`                                                                                                   | high       |
| iso-art-047/L2 | caption-name  | `SCHOOL OF SOCIAL SCIENCE` / `AND LANGUAGE` / `SCHOOL OF PHYSICAL` / `EDUCATION` / `DEPARTMENT OF EDUCATION` | high       |

Caption mapping:

- `BLOCK-18` → numbers 18: `SCHOOL OF SOCIAL SCIENCE AND LANGUAGE SCHOOL OF PHYSICAL EDUCATION DEPARTMENT OF EDUCATION`. single drawn building; caption lists three units without placing them

### iso-art-051 · block-vignette

`51-lpu-isometric-map-design-961.png`. One connected brick-red complex with a curved glazed corner and an entrance canopy, three numbered pins.

| Label id       | Kind          | Exact text as printed                                    | Confidence |
| -------------- | ------------- | -------------------------------------------------------- | ---------- |
| iso-art-051/L1 | block-heading | `BLOCK-19`                                               | high       |
| iso-art-051/L2 | caption-name  | `SCHOOL OF FILMS,` / `JOURNALISM, AND` / `CREATIVE ARTS` | high       |
| iso-art-051/L3 | block-heading | `BLOCK-21`                                               | high       |
| iso-art-051/L4 | caption-name  | `SCHOOL OF LAW`                                          | high       |

Caption mapping:

- `BLOCK-19` → numbers 19: `SCHOOL OF FILMS, JOURNALISM, AND CREATIVE ARTS`. heading number matches pin "19"
- `BLOCK-21` → numbers 21: `SCHOOL OF LAW`. heading number matches pin "21"
- (no heading) → numbers 20: (no caption). pin "20" is drawn but has NO caption on this slide

Boundaries: Pins 19, 20 and 21 sit on one connected mass; boundaries are not marked.

Pins (x, y px): **21** (400, 125), **20** (186, 210), **19** (400, 302).

### iso-art-055 · block-vignette

`55-lpu-isometric-map-design-961.png`. Large interlinked brick-red residential complex around courtyards.

| Label id       | Kind          | Exact text as printed | Confidence |
| -------------- | ------------- | --------------------- | ---------- |
| iso-art-055/L1 | block-heading | `BLOCK-22,23`         | high       |
| iso-art-055/L2 | caption-name  | `GIRLS HOSTAL 5, 6.`  | high       |

Caption mapping:

- `BLOCK-22,23` → numbers 22, 23: `GIRLS HOSTAL 5, 6.`. LISTING ORDER ONLY: 22-5 and 23-6 are implied by order, not stated.

Boundaries: Two pins on a large interlinked courtyard complex; boundaries are not marked.

Pins (x, y px): **23** (373, 198), **22** (258, 258).

### iso-art-059 · block-vignette

`59-lpu-isometric-map-design-961.png`. Four parallel brick-red slab buildings stepping back diagonally, each with a pin.

| Label id       | Kind          | Exact text as printed    | Confidence                           |
| -------------- | ------------- | ------------------------ | ------------------------------------ |
| iso-art-059/L1 | block-heading | `BLOCK-` / `41,42,43,44` | high — Heading printed on two lines. |
| iso-art-059/L2 | caption-name  | `APARTMENTS`             | high                                 |

Caption mapping:

- `BLOCK- 41,42,43,44` → numbers 41, 42, 43, 44: `APARTMENTS`. one caption covers all four pinned buildings

Pins (x, y px): **44** (470, 174), **43** (420, 246), **42** (309, 272), **41** (217, 314).

### iso-art-063 · block-vignette

`63-lpu-isometric-map-design-963.png`. Three parallel linked brick-red slab blocks.

| Label id       | Kind          | Exact text as printed | Confidence |
| -------------- | ------------- | --------------------- | ---------- |
| iso-art-063/L1 | block-heading | `BLOCK- 45`           | high       |
| iso-art-063/L2 | caption-name  | `BOYS HOSTEL-1`       | high       |

Caption mapping:

- `BLOCK- 45` → numbers 45: `BOYS HOSTEL-1`. one caption for the whole drawing (three linked slabs)

### iso-art-067 · block-vignette

`67-lpu-isometric-map-design-961.png`. Diagonal chain of linked brick-red towers with rooftop tanks.

| Label id       | Kind          | Exact text as printed | Confidence |
| -------------- | ------------- | --------------------- | ---------- |
| iso-art-067/L1 | block-heading | `BLOCK- 48, 49`       | high       |
| iso-art-067/L2 | caption-name  | `BOYS HOSTEL -2, 3`   | high       |

Caption mapping:

- `BLOCK- 48, 49` → numbers 48, 49: `BOYS HOSTEL -2, 3`. LISTING ORDER ONLY: 48-2 and 49-3 are implied by order, not stated.

Boundaries: Only two pins on a chain of about six linked towers; which towers belong to 48 and which to 49 is NOT drawn.

Pins (x, y px): **49** (423, 173), **48** (252, 289).

### iso-art-071 · block-vignette

`71-lpu-isometric-map-design-961.png`. Single tall brick-red block with rooftop tanks and a side stair tower.

| Label id       | Kind          | Exact text as printed | Confidence |
| -------------- | ------------- | --------------------- | ---------- |
| iso-art-071/L1 | block-heading | `BLOCK- 50`           | high       |
| iso-art-071/L2 | caption-name  | `BOYS HOSTEL-7`       | high       |

Caption mapping:

- `BLOCK- 50` → numbers 50: `BOYS HOSTEL-7`. single drawn building

### iso-art-075 · block-vignette

`75-lpu-isometric-map-design-961.png`. Diagonal chain of five linked brick-red towers with rooftop tanks.

| Label id       | Kind          | Exact text as printed | Confidence |
| -------------- | ------------- | --------------------- | ---------- |
| iso-art-075/L1 | block-heading | `BLOCK- 51`           | high       |
| iso-art-075/L2 | caption-name  | `BOYS HOSTEL`         | high       |

Caption mapping:

- `BLOCK- 51` → numbers 51: `BOYS HOSTEL`. one caption for a chain of five linked towers; no hostel number is printed

### iso-art-079 · block-vignette

`79-lpu-isometric-map-design-961.png`. Long central spine with perpendicular brick-red slab wings.

| Label id       | Kind          | Exact text as printed | Confidence |
| -------------- | ------------- | --------------------- | ---------- |
| iso-art-079/L1 | block-heading | `BLOCK- 53, 54`       | high       |
| iso-art-079/L2 | caption-name  | `BOYS HOSTEL - 5, 6`  | high       |

Caption mapping:

- `BLOCK- 53, 54` → numbers 53, 54: `BOYS HOSTEL - 5, 6`. LISTING ORDER ONLY: 53-5 and 54-6 are implied by order, not stated.

Boundaries: Two pins on a large spine-and-wing complex; boundaries are not marked.

Pins (x, y px): **53** (358, 162), **54** (437, 210).

### iso-art-083 · block-vignette

`83-lpu-isometric-map-design-961.png`. Crescent-shaped connected brick-red complex.

| Label id       | Kind          | Exact text as printed                 | Confidence |
| -------------- | ------------- | ------------------------------------- | ---------- |
| iso-art-083/L1 | block-heading | `BLOCK- 55`                           | high       |
| iso-art-083/L2 | caption-name  | `SCHOOL OF MECHANICAL` / `INGNEERING` | high       |
| iso-art-083/L3 | block-heading | `BLOCK- 56`                           | high       |
| iso-art-083/L4 | caption-name  | `SCHOOL OF CIVIL INGNEERING`          | high       |
| iso-art-083/L5 | block-heading | `BLOCK- 57`                           | high       |
| iso-art-083/L6 | caption-name  | `SCHOOL OF POLYTECHNIC`               | high       |

Caption mapping:

- `BLOCK- 55` → numbers 55: `SCHOOL OF MECHANICAL INGNEERING`. heading number matches pin "55"
- `BLOCK- 56` → numbers 56: `SCHOOL OF CIVIL INGNEERING`. heading number matches pin "56"
- `BLOCK- 57` → numbers 57: `SCHOOL OF POLYTECHNIC`. heading number matches pin "57"

Boundaries: Pins 55, 56, 57 sit on one crescent-shaped connected mass; boundaries are not marked.

Pins (x, y px): **57** (347, 143), **56** (262, 217), **55** (355, 287).

### iso-art-087 · block-vignette

`87-lpu-isometric-map-design-963.png`. Large connected academic complex: a Y-shaped block around a fan-shaped auditorium bowl (pin 35), a comb of linked blocks (25-29) and a separate group (30-34).

| Label id       | Kind              | Exact text as printed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Confidence                                                                                                                                                                                                                                                                                                               |
| -------------- | ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| iso-art-087/L1 | block-caption-run | `BLOCK-25,26: SCHOOL OF AGRICULTURE ;BLOCK-27: SCHOOL OF CHEMICAL ENGINEERING AND PHYSICAL SCIENCE ;` / `BLOCK-28: SCHOOL OF BIO ENGINEERING AND BIO SCIENCES; BLOCK-29: OFFICE OF THE PRO-CHANCELLOR  I) ADMINISTRATION-II` / `BLOCK-30: THE CHANCELLORY  I) ADMINISTRATION-I ; BLOCK-31: I) DIVISSION OF ADMISSIONS II)MUSEUM OF ACADEMICS ;` / `BLOCK-32: I) OFFICE OF VICE CHANCELLORY II)ADMINISTRATION-III ; BLOCK-33,34 : SCHOOL OF COMPUTER SCIENCE AND ENGINEERING` / `BLOCK-35: SHANTI DEVI MITTAL AUDITORIUM ; BLOCK-36: SCHOOL OF ELECTRONICS & ELECTRICAL ENGINEERING ; BLOCK-37: CENTRAL` / `LIBRARY ; BLOCK-38: SCHOOL OF COMPUTER APPLICATIONS` | medium — Six printed lines under the drawing; "BLOCK-nn:" parts are orange, the rest grey italic. Cap height is about 9 px, so spelling is high confidence but spacing and punctuation (double spaces before "I)", spaces around ";" and ":") are medium confidence. "I)" is printed as a capital I and kept as printed. |

Caption mapping:

- `BLOCK-25,26:` → numbers 25, 26: `SCHOOL OF AGRICULTURE`. one caption covers two pinned buildings
- `BLOCK-27:` → numbers 27: `SCHOOL OF CHEMICAL ENGINEERING AND PHYSICAL SCIENCE`. number matches pin
- `BLOCK-28:` → numbers 28: `SCHOOL OF BIO ENGINEERING AND BIO SCIENCES`. number matches pin
- `BLOCK-29:` → numbers 29: `OFFICE OF THE PRO-CHANCELLOR  I) ADMINISTRATION-II`. number matches pin
- `BLOCK-30:` → numbers 30: `THE CHANCELLORY  I) ADMINISTRATION-I`. number matches pin
- `BLOCK-31:` → numbers 31: `I) DIVISSION OF ADMISSIONS II)MUSEUM OF ACADEMICS`. number matches pin
- `BLOCK-32:` → numbers 32: `I) OFFICE OF VICE CHANCELLORY II)ADMINISTRATION-III`. number matches pin
- `BLOCK-33,34 :` → numbers 33, 34: `SCHOOL OF COMPUTER SCIENCE AND ENGINEERING`. one caption covers two pinned buildings
- `BLOCK-35:` → numbers 35: `SHANTI DEVI MITTAL AUDITORIUM`. number matches pin
- `BLOCK-36:` → numbers 36: `SCHOOL OF ELECTRONICS & ELECTRICAL ENGINEERING`. number matches pin
- `BLOCK-37:` → numbers 37: `CENTRAL LIBRARY`. number matches pin; caption wraps across printed lines 5-6
- `BLOCK-38:` → numbers 38: `SCHOOL OF COMPUTER APPLICATIONS`. number matches pin

Boundaries: Pins 35-38 sit on one connected Y-shaped mass around a fan-shaped bowl, and 25-29 on a linked comb; boundaries between blocks are not marked.

Pins (x, y px): **25** (744, 110), **26** (677, 145), **27** (626, 177), **28** (569, 213), **29** (504, 255), **30** (431, 298), **31** (352, 284), **32** (302, 260), **33** (267, 236), **34** (221, 197), **35** (417, 224), **36** (334, 149), **37** (424, 124), **38** (527, 111).

### iso-art-091 · scene-vignette (entrance)

`91-lpu-isometric-map-design-961.png`. Title slide. Entrance scene: tall maroon gate tower with emblem roundels and a blue glass top, a multi-lane gate canopy, a second gate with a slim pylon and low red buildings, tree-lined roads and green lane dividers.

| Label id       | Kind              | Exact text as printed | Confidence                                                                                                                                                   |
| -------------- | ----------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| iso-art-091/L1 | title             | `LPU MAP`             | high — Title of the slide set.                                                                                                                               |
| iso-art-091/L2 | scene-caption     | `UNIVERSITY ENTRENCE` | high                                                                                                                                                         |
| iso-art-091/L3 | signage-microtext | `(illegible)`         | low — Tiny sign text on the gate canopies and on the gate tower/pylon (orange glyphs and emblem roundels). Unreadable at source resolution; not transcribed. |

### iso-art-095 · scene-vignette (parking)

`95-lpu-isometric-map-design-961.png`. Large parking lot full of cars, a lawn with one large tree, benches and a small red hut, roads with green lane dividers and part of the maroon gate tower.

| Label id       | Kind          | Exact text as printed          | Confidence |
| -------------- | ------------- | ------------------------------ | ---------- |
| iso-art-095/L1 | scene-caption | `PARKING AREA AND GARDEN AREA` | high       |

### iso-art-099 · scene-vignette (flag-area)

`99-lpu-isometric-map-design-961.png`. Tall flagpole with the Indian flag, square garden with a statue on a plinth, benches and lamps, a shrub grid, an arched covered walkway and staircase (upper left), a lawn with one large tree and a small red hut.

| Label id       | Kind          | Exact text as printed | Confidence |
| -------------- | ------------- | --------------------- | ---------- |
| iso-art-099/L1 | scene-caption | `FLAG AREA`           | high       |

### iso-art-103 · scene-vignette (garden)

`103-lpu-isometric-map-design-961.png`. Rectangular walled lawn with trees and a paved patch, between grey buildings and a road.

| Label id       | Kind          | Exact text as printed | Confidence                                                                                                                                            |
| -------------- | ------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| iso-art-103/L1 | scene-caption | `DILDO PARK`          | high — Transcribed exactly as printed. Its meaning is unclear; it must not be used as a place name without independent confirmation (owner decision). |

### iso-art-107 · scene-vignette (garden)

`107-lpu-isometric-map-design-961.png`. Rectangular garden with a regular grid of shrubs/trees; pin 4 on a grey comb-fronted building; pin 5 (its pointer cut by the scene frame) on a red building corner across the road.

| Label id       | Kind          | Exact text as printed | Confidence |
| -------------- | ------------- | --------------------- | ---------- |
| iso-art-107/L1 | scene-caption | `GARDEN AREA`         | high       |

Pins (x, y px): **4** (640, 239), **5** (245, 381).

### iso-art-111 · scene-vignette (open-auditorium)

`111-lpu-isometric-map-design-963.png`. Large grey perforated pavilion roof with solar panels on red columns (pin 16), wedge building (pin 15), building with a tree row (pin 14), building on the right (pin 18), a row of flag poles and a tree-lined road upper left, a blue covered walkway.

| Label id       | Kind          | Exact text as printed              | Confidence                                                                                                          |
| -------------- | ------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| iso-art-111/L1 | scene-caption | `OPEN AUDITORIUM AND SURROUNDINGS` | high                                                                                                                |
| iso-art-111/L2 | pin-label     | `(illegible)`                      | low — A further pin head is cut off by the bottom edge of the scene frame near x 413, y 405; no digits are visible. |

Pins (x, y px): **14** (346, 298), **16** (535, 276), **15** (631, 379), **18** (807, 225).

### iso-art-115 · scene-vignette (open-auditorium)

`115-lpu-isometric-map-design-963.png`, byte-identical to iso-art-111. Byte-identical duplicate of iso-art-111.

| Label id       | Kind          | Exact text as printed              | Confidence                                                   |
| -------------- | ------------- | ---------------------------------- | ------------------------------------------------------------ |
| iso-art-115/L1 | scene-caption | `OPEN AUDITORIUM AND SURROUNDINGS` | high                                                         |
| iso-art-115/L2 | pin-label     | `(illegible)`                      | low — Same clipped pin as iso-art-111 (byte-identical file). |

Pins (x, y px): **14** (346, 298), **16** (535, 276), **15** (631, 379), **18** (807, 225).

### iso-art-119 · scene-vignette (playground)

`119-lpu-isometric-map-design-961.png`. Cricket oval with pitch (pin 52 on the oval, not on a building), tennis and basketball courts, open fields, a parking strip along the outer road, hostel complexes (pins 48, 51, 53, 54), the crescent complex (55, 56, 57), round green tanks and a water tower.

| Label id       | Kind          | Exact text as printed | Confidence |
| -------------- | ------------- | --------------------- | ---------- |
| iso-art-119/L1 | scene-caption | `PLAYGROUND`          | high       |

Pins (x, y px): **57** (208, 282), **56** (206, 320), **55** (269, 333), **54** (382, 371), **53** (427, 396), **52** (630, 179), **51** (799, 211), **48** (791, 317), **58** (161, 276) [low].

## Master overview (iso-art-001)

Whole-campus isometric illustration inside a dark frame: numbered white pins, LPU logo and wordmark block (top centre), INFORMATION index (right panel), legend (bottom left), roads, parking, gardens and the surrounding area in pale yellow.

Approximate regions (±15 px, [x, y, w, h]): map area [25,25,2575,2330], logo block [1805,30,745,432], INFORMATION panel [2600,25,742,2330], legend box [88,1900,650,405].

### INFORMATION index, row by row

Heading: `INFORMATION`. Rows transcribed top to bottom exactly as printed. "21A,B" is read as 21A and 21B; that split interprets the printed shorthand.

**EDUCATION** (blue text)

| Row | Label as printed       | Numbers as printed |
| --- | ---------------------- | ------------------ |
| 1   | `FASHION`              | `1`                |
| 2   | `PHARMACY`             | `4,7`              |
| 3   | `PHYSIOTHERAPY`        | `3`                |
| 4   | `ARCHITECTURE`         | `6`                |
| 5   | `ANIMATION`            | `8`                |
| 6   | `FINE ARTS`            | `8`                |
| 7   | `BUSINESS`             | `13`               |
| 8   | `HOTEL MANAGEMENT`     | `15`               |
| 9   | `EDUCATION`            | `18`               |
| 10  | `PERFORMING ARTS`      | `19`               |
| 11  | `FILM & JOURNALISM`    | `20`               |
| 12  | `LAW`                  | `20`               |
| 13  | `AGRICULTURE`          | `25,26`            |
| 14  | `PHYSICAL SCIENCE`     | `27`               |
| 15  | `BIOTECHNOLOGY`        | `28`               |
| 16  | `COMPUTER APPLICATION` | `33`               |
| 17  | `COMPTER SCIENCE`      | `34`               |
| 18  | `ELECTRONIC TELECOM`   | `36`               |
| 19  | `RESEARCH`             | `37`               |
| 20  | `CIVIL`                | `38`               |
| 21  | `MECHANICAL`           | `56`               |
| 22  | `POLYTECHINQUE`        | `57`               |
| 23  | (blank)                | `58`               |

**ADMINISTRATIVE** (maroon text)

| Row | Label as printed        | Numbers as printed |
| --- | ----------------------- | ------------------ |
| 1   | `ADMINISTRATIVE`        | `29`               |
| 2   | `PROCHANCELLOR`         | `30`               |
| 3   | `CHANCELLOR`            | `31`               |
| 4   | `ADMINISTRATIVE`        | `31`               |
| 5   | `ADMISSION`             | `32`               |
| 6   | `STUDENT WELFARE`       | `13`               |
| 7   | `SHANTIDEVI AUDITORIUM` | `35`               |
| 8   | `BALDEV RAJ AUDITORIUM` | `2`                |
| 9   | `INDOOR`                | `47`               |
| 10  | `PROJECT LAB`           | `58`               |

**RESIDENTIAL** (gold text)

| Row | Label as printed | Numbers as printed               |
| --- | ---------------- | -------------------------------- |
| 1   | `GIRLS HOSTEL`   | `9,10,` / `11,12,` / `21A,B`     |
| 2   | `APARTMENT`      | `41,42,` / `43,44`               |
| 3   | `BOYS HOSTEL`    | `45,48,` / `49,50,` / `51,53,52` |

### Legend

| Label as printed        | Swatch                        |
| ----------------------- | ----------------------------- |
| `GARDEN OR GROUND AREA` | green swatch                  |
| `ROAD`                  | dark swatch with white dashes |
| `PEDISTRIAN`            | dusty-pink swatch             |
| `PARKING AREA`          | dark-grey swatch              |
| `LPU SURROUNDINGS`      | pale-yellow swatch            |

### Logo block

- `LOVELY` / `PROFESSIONAL` / `UNIVERSITY` / `PUNJAB (INDIA)`. Text around the circular LPU emblem (part of the LPU logo as drawn in the artwork; not a place label).
- `L OVELY` / `P ROFESSIONAL` / `U NIVERSITY`. Wordmark: the initials L, P, U sit in orange boxes followed by "OVELY", "ROFESSIONAL", "NIVERSITY" (reads LOVELY PROFESSIONAL UNIVERSITY).
- `Transforming Education Transforming India`. Script tagline under the wordmark (mixed case as printed).

### Overview pins

45 pins, all re-verified: Pin centres were first measured in docs/research/block-leads/matching-fit.json ("uv") and re-verified here on 2.6x crops: each lies inside its disc (radius about 9-14 px) and the digits match. An automated white-disc scan of the map area found no further pins. A disc does not mark an exact ground point.

| Pin | x    | y    | nx      | ny      |
| --- | ---- | ---- | ------- | ------- |
| 1   | 1276 | 1707 | 0.37852 | 0.71602 |
| 2   | 1401 | 1596 | 0.4156  | 0.66946 |
| 3   | 1562 | 1448 | 0.46336 | 0.60738 |
| 4   | 1431 | 1380 | 0.4245  | 0.57886 |
| 6   | 1168 | 1306 | 0.34648 | 0.54782 |
| 7   | 1289 | 1229 | 0.38238 | 0.51552 |
| 8   | 1225 | 1215 | 0.36339 | 0.50965 |
| 9   | 1401 | 1166 | 0.4156  | 0.48909 |
| 10  | 1505 | 1112 | 0.44646 | 0.46644 |
| 11  | 1421 | 1065 | 0.42154 | 0.44673 |
| 12  | 1323 | 1150 | 0.39247 | 0.48238 |
| 13  | 1146 | 1080 | 0.33996 | 0.45302 |
| 14  | 1104 | 1011 | 0.3275  | 0.42408 |
| 15  | 1279 | 1050 | 0.37941 | 0.44044 |
| 18  | 1365 | 976  | 0.40492 | 0.4094  |
| 20  | 1385 | 888  | 0.41086 | 0.37248 |
| 21  | 1276 | 740  | 0.37852 | 0.3104  |
| 25  | 1123 | 792  | 0.33314 | 0.33221 |
| 26  | 1098 | 812  | 0.32572 | 0.3406  |
| 27  | 1085 | 837  | 0.32186 | 0.35109 |
| 28  | 1057 | 847  | 0.31356 | 0.35529 |
| 29  | 1038 | 865  | 0.30792 | 0.36284 |
| 30  | 1005 | 882  | 0.29813 | 0.36997 |
| 32  | 977  | 877  | 0.28982 | 0.36787 |
| 33  | 958  | 850  | 0.28419 | 0.35654 |
| 34  | 920  | 842  | 0.27292 | 0.35319 |
| 35  | 1003 | 850  | 0.29754 | 0.35654 |
| 36  | 967  | 820  | 0.28686 | 0.34396 |
| 37  | 1007 | 814  | 0.29872 | 0.34144 |
| 38  | 1057 | 805  | 0.31356 | 0.33767 |
| 41  | 1070 | 728  | 0.31741 | 0.30537 |
| 42  | 1112 | 716  | 0.32987 | 0.30034 |
| 43  | 1158 | 715  | 0.34352 | 0.29992 |
| 44  | 1156 | 669  | 0.34292 | 0.28062 |
| 45  | 1225 | 581  | 0.36339 | 0.24371 |
| 47  | 1050 | 651  | 0.31148 | 0.27307 |
| 48  | 984  | 521  | 0.2919  | 0.21854 |
| 49  | 1037 | 521  | 0.30762 | 0.21854 |
| 50  | 1214 | 396  | 0.36013 | 0.16611 |
| 51  | 973  | 403  | 0.28864 | 0.16904 |
| 53  | 551  | 614  | 0.16345 | 0.25755 |
| 54  | 490  | 583  | 0.14536 | 0.24455 |
| 56  | 346  | 517  | 0.10264 | 0.21686 |
| 57  | 263  | 524  | 0.07802 | 0.2198  |
| 58  | 275  | 465  | 0.08158 | 0.19505 |

Numbers shown elsewhere but with **no pin on the overview**: 5, 16, 19, 22, 23, 31, 52, 55.

## Scenes

| Asset                                  | Scene           | Caption as printed                 |
| -------------------------------------- | --------------- | ---------------------------------- |
| iso-art-091                            | entrance        | `UNIVERSITY ENTRENCE`              |
| iso-art-095                            | parking         | `PARKING AREA AND GARDEN AREA`     |
| iso-art-099                            | flag-area       | `FLAG AREA`                        |
| iso-art-103                            | garden          | `DILDO PARK`                       |
| iso-art-107                            | garden          | `GARDEN AREA`                      |
| iso-art-111                            | open-auditorium | `OPEN AUDITORIUM AND SURROUNDINGS` |
| iso-art-115 (duplicate of iso-art-111) | open-auditorium | `OPEN AUDITORIUM AND SURROUNDINGS` |
| iso-art-119                            | playground      | `PLAYGROUND`                       |

## Artwork numbers and where they appear

These are numbers **printed in the artwork**. None is an official LPU block number (`isOfficialBlockNumber: false` throughout). Where an official LPU page mentions the same number, the JSON carries a pointer to `docs/research/block-leads/official-block-confirmations.json` for context only. Those pointers cover Blocks 13, 35, 37 and "Building No. 32".

| Number | Appears in                                                                                                                                                                                                                 |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | iso-art-001 overview index `FASHION`; iso-art-001 overview pin; iso-art-011 vignette caption `SCHOOL OF FASHION`                                                                                                           |
| 2      | iso-art-001 overview index `BALDEV RAJ AUDITORIUM`; iso-art-001 overview pin; iso-art-015 vignette caption `CAMPUS CAFE  & BALDEV RAJ AUDITORIUM`                                                                          |
| 3      | iso-art-001 overview index `PHYSIOTHERAPY`; iso-art-001 overview pin; iso-art-019 vignette caption `SCHOOL OF PHYSIOTHERAPHY AND PARAMEDICAL SCIENCE`                                                                      |
| 4      | iso-art-001 overview index `PHARMACY`; iso-art-001 overview pin; iso-art-023 vignette caption `SCHOOL OF PHARAMACEUTICAL SCIENCE`; iso-art-107 scene pin                                                                   |
| 5      | iso-art-107 scene pin                                                                                                                                                                                                      |
| 6      | iso-art-001 overview index `ARCHITECTURE`; iso-art-001 overview pin; iso-art-027 vignette caption `SCHOOL OF ARCHITECRURE & PLANING DIVISION OF CONSTRUCTIONS DIVISION OF ARCHITECTURE & DESIGN`; iso-art-027 vignette pin |
| 7      | iso-art-001 overview index `PHARMACY`; iso-art-001 overview pin; iso-art-027 vignette caption `DEPARTMENT OF PHARMACEUTICAL SCIENCE`; iso-art-027 vignette pin                                                             |
| 8      | iso-art-001 overview index `ANIMATION`; iso-art-001 overview index `FINE ARTS`; iso-art-001 overview pin; iso-art-027 vignette caption `SCHOOL OF FINE ARTS AND SCHOOL OF DESIGN (MULTIMEDIA)`; iso-art-027 vignette pin   |
| 9      | iso-art-001 overview index `GIRLS HOSTEL`; iso-art-001 overview pin; iso-art-031 vignette caption `GIRLS HOSTAL 1, 2, 3, 4`; iso-art-031 vignette pin                                                                      |
| 10     | iso-art-001 overview index `GIRLS HOSTEL`; iso-art-001 overview pin; iso-art-031 vignette caption `GIRLS HOSTAL 1, 2, 3, 4`; iso-art-031 vignette pin                                                                      |
| 11     | iso-art-001 overview index `GIRLS HOSTEL`; iso-art-001 overview pin; iso-art-031 vignette caption `GIRLS HOSTAL 1, 2, 3, 4`; iso-art-031 vignette pin                                                                      |
| 12     | iso-art-001 overview index `GIRLS HOSTEL`; iso-art-001 overview pin; iso-art-031 vignette caption `GIRLS HOSTAL 1, 2, 3, 4`; iso-art-031 vignette pin                                                                      |
| 13     | iso-art-001 overview index `BUSINESS`; iso-art-001 overview index `STUDENT WELFARE`; iso-art-001 overview pin; iso-art-035 vignette caption `DIVISION OF STUDENT WELFARE`                                                  |
| 14     | iso-art-001 overview pin; iso-art-039 vignette caption `MITTAL SCHOOL OF BUSINESS`; iso-art-111 scene pin                                                                                                                  |
| 15     | iso-art-001 overview index `HOTEL MANAGEMENT`; iso-art-001 overview pin; iso-art-043 vignette caption `UNI-CENTER, SCHOOL OF HOTAL MANGMENT AND TOURISM`; iso-art-111 scene pin                                            |
| 16     | iso-art-111 scene pin                                                                                                                                                                                                      |
| 18     | iso-art-001 overview index `EDUCATION`; iso-art-001 overview pin; iso-art-047 vignette caption `SCHOOL OF SOCIAL SCIENCE AND LANGUAGE SCHOOL OF PHYSICAL EDUCATION DEPARTMENT OF EDUCATION`; iso-art-111 scene pin         |
| 19     | iso-art-001 overview index `PERFORMING ARTS`; iso-art-051 vignette caption `SCHOOL OF FILMS, JOURNALISM, AND CREATIVE ARTS`; iso-art-051 vignette pin                                                                      |
| 20     | iso-art-001 overview index `FILM & JOURNALISM`; iso-art-001 overview index `LAW`; iso-art-001 overview pin; iso-art-051 vignette pin without caption; iso-art-051 vignette pin                                             |
| 21     | iso-art-001 overview pin; iso-art-051 vignette caption `SCHOOL OF LAW`; iso-art-051 vignette pin                                                                                                                           |
| 21A    | iso-art-001 overview index `GIRLS HOSTEL`                                                                                                                                                                                  |
| 21B    | iso-art-001 overview index `GIRLS HOSTEL`                                                                                                                                                                                  |
| 22     | iso-art-055 vignette caption `GIRLS HOSTAL 5, 6.`; iso-art-055 vignette pin                                                                                                                                                |
| 23     | iso-art-055 vignette caption `GIRLS HOSTAL 5, 6.`; iso-art-055 vignette pin                                                                                                                                                |
| 25     | iso-art-001 overview index `AGRICULTURE`; iso-art-001 overview pin; iso-art-087 vignette caption `SCHOOL OF AGRICULTURE`; iso-art-087 vignette pin                                                                         |
| 26     | iso-art-001 overview index `AGRICULTURE`; iso-art-001 overview pin; iso-art-087 vignette caption `SCHOOL OF AGRICULTURE`; iso-art-087 vignette pin                                                                         |
| 27     | iso-art-001 overview index `PHYSICAL SCIENCE`; iso-art-001 overview pin; iso-art-087 vignette caption `SCHOOL OF CHEMICAL ENGINEERING AND PHYSICAL SCIENCE`; iso-art-087 vignette pin                                      |
| 28     | iso-art-001 overview index `BIOTECHNOLOGY`; iso-art-001 overview pin; iso-art-087 vignette caption `SCHOOL OF BIO ENGINEERING AND BIO SCIENCES`; iso-art-087 vignette pin                                                  |
| 29     | iso-art-001 overview index `ADMINISTRATIVE`; iso-art-001 overview pin; iso-art-087 vignette caption `OFFICE OF THE PRO-CHANCELLOR  I) ADMINISTRATION-II`; iso-art-087 vignette pin                                         |
| 30     | iso-art-001 overview index `PROCHANCELLOR`; iso-art-001 overview pin; iso-art-087 vignette caption `THE CHANCELLORY  I) ADMINISTRATION-I`; iso-art-087 vignette pin                                                        |
| 31     | iso-art-001 overview index `CHANCELLOR`; iso-art-001 overview index `ADMINISTRATIVE`; iso-art-087 vignette caption `I) DIVISSION OF ADMISSIONS II)MUSEUM OF ACADEMICS`; iso-art-087 vignette pin                           |
| 32     | iso-art-001 overview index `ADMISSION`; iso-art-001 overview pin; iso-art-087 vignette caption `I) OFFICE OF VICE CHANCELLORY II)ADMINISTRATION-III`; iso-art-087 vignette pin                                             |
| 33     | iso-art-001 overview index `COMPUTER APPLICATION`; iso-art-001 overview pin; iso-art-087 vignette caption `SCHOOL OF COMPUTER SCIENCE AND ENGINEERING`; iso-art-087 vignette pin                                           |
| 34     | iso-art-001 overview index `COMPTER SCIENCE`; iso-art-001 overview pin; iso-art-087 vignette caption `SCHOOL OF COMPUTER SCIENCE AND ENGINEERING`; iso-art-087 vignette pin                                                |
| 35     | iso-art-001 overview index `SHANTIDEVI AUDITORIUM`; iso-art-001 overview pin; iso-art-087 vignette caption `SHANTI DEVI MITTAL AUDITORIUM`; iso-art-087 vignette pin                                                       |
| 36     | iso-art-001 overview index `ELECTRONIC TELECOM`; iso-art-001 overview pin; iso-art-087 vignette caption `SCHOOL OF ELECTRONICS & ELECTRICAL ENGINEERING`; iso-art-087 vignette pin                                         |
| 37     | iso-art-001 overview index `RESEARCH`; iso-art-001 overview pin; iso-art-087 vignette caption `CENTRAL LIBRARY`; iso-art-087 vignette pin                                                                                  |
| 38     | iso-art-001 overview index `CIVIL`; iso-art-001 overview pin; iso-art-087 vignette caption `SCHOOL OF COMPUTER APPLICATIONS`; iso-art-087 vignette pin                                                                     |
| 41     | iso-art-001 overview index `APARTMENT`; iso-art-001 overview pin; iso-art-059 vignette caption `APARTMENTS`; iso-art-059 vignette pin                                                                                      |
| 42     | iso-art-001 overview index `APARTMENT`; iso-art-001 overview pin; iso-art-059 vignette caption `APARTMENTS`; iso-art-059 vignette pin                                                                                      |
| 43     | iso-art-001 overview index `APARTMENT`; iso-art-001 overview pin; iso-art-059 vignette caption `APARTMENTS`; iso-art-059 vignette pin                                                                                      |
| 44     | iso-art-001 overview index `APARTMENT`; iso-art-001 overview pin; iso-art-059 vignette caption `APARTMENTS`; iso-art-059 vignette pin                                                                                      |
| 45     | iso-art-001 overview index `BOYS HOSTEL`; iso-art-001 overview pin; iso-art-063 vignette caption `BOYS HOSTEL-1`                                                                                                           |
| 47     | iso-art-001 overview index `INDOOR`; iso-art-001 overview pin                                                                                                                                                              |
| 48     | iso-art-001 overview index `BOYS HOSTEL`; iso-art-001 overview pin; iso-art-067 vignette caption `BOYS HOSTEL -2, 3`; iso-art-067 vignette pin; iso-art-119 scene pin                                                      |
| 49     | iso-art-001 overview index `BOYS HOSTEL`; iso-art-001 overview pin; iso-art-067 vignette caption `BOYS HOSTEL -2, 3`; iso-art-067 vignette pin                                                                             |
| 50     | iso-art-001 overview index `BOYS HOSTEL`; iso-art-001 overview pin; iso-art-071 vignette caption `BOYS HOSTEL-7`                                                                                                           |
| 51     | iso-art-001 overview index `BOYS HOSTEL`; iso-art-001 overview pin; iso-art-075 vignette caption `BOYS HOSTEL`; iso-art-119 scene pin                                                                                      |
| 52     | iso-art-001 overview index `BOYS HOSTEL`; iso-art-119 scene pin                                                                                                                                                            |
| 53     | iso-art-001 overview index `BOYS HOSTEL`; iso-art-001 overview pin; iso-art-079 vignette caption `BOYS HOSTEL - 5, 6`; iso-art-079 vignette pin; iso-art-119 scene pin                                                     |
| 54     | iso-art-001 overview pin; iso-art-079 vignette caption `BOYS HOSTEL - 5, 6`; iso-art-079 vignette pin; iso-art-119 scene pin                                                                                               |
| 55     | iso-art-083 vignette caption `SCHOOL OF MECHANICAL INGNEERING`; iso-art-083 vignette pin; iso-art-119 scene pin                                                                                                            |
| 56     | iso-art-001 overview index `MECHANICAL`; iso-art-001 overview pin; iso-art-083 vignette caption `SCHOOL OF CIVIL INGNEERING`; iso-art-083 vignette pin; iso-art-119 scene pin                                              |
| 57     | iso-art-001 overview index `POLYTECHINQUE`; iso-art-001 overview pin; iso-art-083 vignette caption `SCHOOL OF POLYTECHNIC`; iso-art-083 vignette pin; iso-art-119 scene pin                                                |
| 58     | iso-art-001 overview index `(blank label)`; iso-art-001 overview index `PROJECT LAB`; iso-art-001 overview pin; iso-art-119 scene pin                                                                                      |

Never shown anywhere (1–58): 17, 24, 39, 40, 46.

## Conflicts (recorded, not resolved)

| Id  | Numbers                       | Conflict                                                                                                                                                                                                                                                                                                                         |
| --- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C01 | 2                             | Vignette caption "CAMPUS CAFE & BALDEV RAJ AUDITORIUM"; index lists only "BALDEV RAJ AUDITORIUM 2".                                                                                                                                                                                                                              |
| C02 | 4, 7                          | Index "PHARMACY 4,7"; vignettes: 4 "SCHOOL OF PHARAMACEUTICAL SCIENCE", 7 "DEPARTMENT OF PHARMACEUTICAL SCIENCE". Consistent in subject, but two numbers for one subject.                                                                                                                                                        |
| C03 | 13, 14                        | Index EDUCATION "BUSINESS 13" and ADMINISTRATIVE "STUDENT WELFARE 13"; vignette 13 "DIVISION OF STUDENT WELFARE"; vignette 14 "MITTAL SCHOOL OF BUSINESS". 14 is not in the index (it has an overview pin).                                                                                                                      |
| C04 | 15                            | Vignette adds "UNI-CENTER,"; index lists only "HOTEL MANAGEMENT 15".                                                                                                                                                                                                                                                             |
| C05 | 18                            | Vignette lists three units; index names only "EDUCATION 18".                                                                                                                                                                                                                                                                     |
| C06 | 19, 20, 21                    | Index: "PERFORMING ARTS 19", "FILM & JOURNALISM 20", "LAW 20". Vignette: 19 "SCHOOL OF FILMS, JOURNALISM, AND CREATIVE ARTS", 21 "SCHOOL OF LAW", pin 20 uncaptioned. Overview has pins 20 and 21 but not 19.                                                                                                                    |
| C07 | 21, 21A, 21B, 22, 23          | Index RESIDENTIAL "GIRLS HOSTEL 9,10, 11,12, 21A,B"; vignette 21 = "SCHOOL OF LAW"; vignette "BLOCK-22,23 GIRLS HOSTAL 5, 6." has no index row and no overview pins. Relationship between 21A/21B and 22/23 is unknown.                                                                                                          |
| C08 | 27                            | Index "PHYSICAL SCIENCE 27"; vignette "SCHOOL OF CHEMICAL ENGINEERING AND PHYSICAL SCIENCE".                                                                                                                                                                                                                                     |
| C09 | 28                            | Index "BIOTECHNOLOGY 28"; vignette "SCHOOL OF BIO ENGINEERING AND BIO SCIENCES".                                                                                                                                                                                                                                                 |
| C10 | 29, 30, 31, 32                | Administrative numbers differ: vignette 29 PRO-CHANCELLOR + ADMINISTRATION-II, 30 CHANCELLORY + ADMINISTRATION-I, 31 DIVISSION OF ADMISSIONS + MUSEUM OF ACADEMICS, 32 VICE CHANCELLORY + ADMINISTRATION-III; index 29 ADMINISTRATIVE, 30 PROCHANCELLOR, 31 CHANCELLOR and ADMINISTRATIVE, 32 ADMISSION. Overview has no pin 31. |
| C11 | 33, 38                        | Index "COMPUTER APPLICATION 33" and "CIVIL 38"; vignette 33,34 "SCHOOL OF COMPUTER SCIENCE AND ENGINEERING" and 38 "SCHOOL OF COMPUTER APPLICATIONS".                                                                                                                                                                            |
| C12 | 36                            | Index "ELECTRONIC TELECOM 36"; vignette "SCHOOL OF ELECTRONICS & ELECTRICAL ENGINEERING".                                                                                                                                                                                                                                        |
| C13 | 37                            | Index "RESEARCH 37"; vignette "CENTRAL LIBRARY". (An official LPU page states Block-37 = Central Library; recorded as a pointer only.)                                                                                                                                                                                           |
| C14 | 55, 56, 38                    | Vignette 55 "SCHOOL OF MECHANICAL INGNEERING", 56 "SCHOOL OF CIVIL INGNEERING"; index "MECHANICAL 56", "CIVIL 38". 55 is not in the index and has no overview pin.                                                                                                                                                               |
| C15 | 57                            | Index "POLYTECHINQUE 57"; vignette "SCHOOL OF POLYTECHNIC" (same subject, different wording).                                                                                                                                                                                                                                    |
| C16 | 58                            | Index EDUCATION ends with a row "58" that has no label; ADMINISTRATIVE has "PROJECT LAB 58". No vignette; a clipped pin read as "58" at the left edge of PLAYGROUND (low confidence).                                                                                                                                            |
| C17 | 51, 52, 53, 54                | Index BOYS HOSTEL "45,48, 49,50, 51,53,52" includes 52 (whose only pin is on the cricket oval in PLAYGROUND, not on a building) and omits 54, which the vignette captions as a boys hostel.                                                                                                                                      |
| C18 | 45, 48, 49, 50, 51, 53, 54    | Boys-hostel numbering on vignettes: 45 BOYS HOSTEL-1, 48,49 BOYS HOSTEL -2, 3 (by order), 50 BOYS HOSTEL-7, 51 BOYS HOSTEL (no number), 53,54 BOYS HOSTEL - 5, 6 (by order). Boys Hostel 4 is never assigned. Do not infer 51 = 4.                                                                                               |
| C19 | 5, 16, 19, 22, 23, 31, 52, 55 | Numbers that appear on vignettes/scenes but have no pin on the master overview.                                                                                                                                                                                                                                                  |
| C20 | 5, 16                         | Scene pins 5 (GARDEN AREA) and 16 (OPEN AUDITORIUM AND SURROUNDINGS) have no caption and no index row anywhere.                                                                                                                                                                                                                  |
| C21 | 47                            | Index "INDOOR 47" and an overview pin; no vignette.                                                                                                                                                                                                                                                                              |

## Corrections to earlier records

- **Legend label.** Was: PEDESTRIAN (docs/research/block-leads/block-leads.json scene contents for slide-28). Now: PEDISTRIAN. Evidence: 3x zoomed crop of the legend box on iso-art-001.
- **PNG transparency.** Was: Task brief: "961x540/541, RGBA, transparent" vignettes. Now: RGBA format, but every interior pixel is opaque; only 1-3 edge columns/rows are partly transparent. Each PNG is a full presentation slide (background, decorative circles, white card), not a cut-out.. Evidence: per-pixel alpha scan (alpha field of each asset).
- **Master colour model.** Was: not recorded before. Now: CMYK JPEG with an embedded U.S. Web Coated (SWOP) v2 profile. Evidence: SOF0 component count 4, APP14 transform 0, ICC header.

## Needs manual verification

- `iso-art-015/L2` (medium): The gap between "CAFE" and "&" is visibly wider than a normal word space (transcribed as two spaces). Words and spelling are high confidence.
- `iso-art-087/L1` (medium): Six printed lines under the drawing; "BLOCK-nn:" parts are orange, the rest grey italic. Cap height is about 9 px, so spelling is high confidence but spacing and punctuation (double spaces before "I)", spaces around ";" and ":") are medium confidence. "I)" is printed as a capital I and kept as printed.
- `iso-art-091/L3` (low): Tiny sign text on the gate canopies and on the gate tower/pylon (orange glyphs and emblem roundels). Unreadable at source resolution; not transcribed.
- `iso-art-111/L2` (low): A further pin head is cut off by the bottom edge of the scene frame near x 413, y 405; no digits are visible.
- `iso-art-115/L2` (low): Same clipped pin as iso-art-111 (byte-identical file).
- `iso-art-119/pin:58` (low): Cut off by the left edge of the scene frame; only part of the number is visible. Reading "58" needs manual verification.
- `iso-art-103/L1` (high): Transcription is certain, but the meaning is unclear; owner must decide whether it may ever be shown.
- `iso-art-001/regionsApprox` (medium): Approximate (+-15 px); measure precisely before using as crop or hotspot bounds.

## Derived contact sheets

These are review previews only. Each is stamped **DERIVED**. Every tile is a whole original scaled uniformly by 0.5, with no crop and no recolour. The tile captions give the asset id, file, size and the start of the sha256.

| Sheet                                                                                                                                         | Bytes  | Sources                                                                                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [sheet-01-master-overview.png](isometric-art/contact-sheets/sheet-01-master-overview.png)                                                     | 972929 | iso-art-001                                                                                                                                                |
| [sheet-02-block-vignettes-other-captions.png](isometric-art/contact-sheets/sheet-02-block-vignettes-other-captions.png)                       | 572098 | iso-art-011, iso-art-015, iso-art-019, iso-art-023, iso-art-027, iso-art-035, iso-art-039, iso-art-043, iso-art-047, iso-art-051, iso-art-083, iso-art-087 |
| [sheet-03-block-vignettes-hostel-apartment-captions.png](isometric-art/contact-sheets/sheet-03-block-vignettes-hostel-apartment-captions.png) | 346516 | iso-art-031, iso-art-055, iso-art-059, iso-art-063, iso-art-067, iso-art-071, iso-art-075, iso-art-079                                                     |
| [sheet-04-scene-vignettes.png](isometric-art/contact-sheets/sheet-04-scene-vignettes.png)                                                     | 498956 | iso-art-091, iso-art-095, iso-art-099, iso-art-103, iso-art-107, iso-art-111, iso-art-115, iso-art-119                                                     |

- Regenerate: `node scripts/isometric-art-contact-sheets.ts`. This uses the installed Playwright Chromium canvas, reads the originals only, refuses to run if any original no longer matches the inventory, and re-checks the originals' sha256 afterwards. Run Prettier on `manifest.json` afterwards.
- Check without Chromium: `node scripts/isometric-art-contact-sheets.ts --check`. The same checks run in `tests/unit/isometric-art-inventory/inventory.test.ts`, which is part of `npm test` and therefore CI. Sheet text uses the system font, so sheet bytes may differ between machines. The check compares each committed sheet with its manifest entry, and each sheet's recorded source sha256 with the inventory. A changed original therefore fails CI until the inventory and sheets are updated deliberately.

## Method

1. sha256, size and header fields were read from the bytes: PNG IHDR and chunks; JPEG SOF0, APP14, APP2 ICC and XMP. Alpha and the card and frame rectangles were measured per pixel through a Chromium canvas.
2. Every slide was viewed whole, then captions were read on 2.5×–3× crops and the master index, legend and logo on 1.2×–1.4× crops. The results were compared line by line with `docs/research/block-leads/block-leads.json`. Everything matched except the legend `PEDISTRIAN`.
3. The 45 overview pins in `matching-fit.json` were checked with crosshair montages at 2.6×. A white-disc scan of the map area found no extra pins, and a 3.6× gridded crop covered the dense 25–38 cluster. Vignette pins were read on gridded crops and checked the same way, to ±4 px.
4. The originals' sha256 values were recorded before work began and were unchanged after every step, including contact-sheet generation.
