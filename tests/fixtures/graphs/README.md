# Synthetic routing graphs

These fixtures are **invented geometry** for routing tests. They are not LPU
data: coordinates are metre offsets around `APP_CONFIG.map.center`, and every
name ("Synthetic Avenue", "Test Walk", …) is deliberately fake. Never ship them
or use them as a source for the real dataset.

All files follow `graphFileSchema` (`src/data/schema.ts`); tests parse them
with it. Regenerate with:

```sh
node tests/fixtures/graphs/generate-synthetic.ts
```

Coordinates below are `(x east, y north)` in metres from the origin.

## synthetic-diamond.json

Nodes 0 `(0,0)`, 1 `(-40,50)`, 2 `(40,50)`, 3 `(0,100)`; footways 0–1, 0–2,
1–3, 2–3. The two routes 0→3 are mirror images with equal length, used to
check deterministic tie-breaking (predecessor with the smaller node id wins).
Coordinates are kept at full precision so the symmetry is exact to float
rounding.

## synthetic-disconnected.json

Two components 300 m apart (0–1 and 2–3), plus a third component 4–5 where
node 4 sits at **exactly the same coordinate** as node 1 but no edge joins
them. The router must not merge them: 0 → 5 has no path.

## synthetic-campus.json

| Edge | Nodes   | Meaning                                                                        |
| ---- | ------- | ------------------------------------------------------------------------------ |
| 0–2  | 0→1→2→3 | "Synthetic Avenue", residential, `onewayBicycle` eastbound, walkable both ways |
| 3–5  | 0→4→5→3 | Unnamed footway loop north (80 + 300 + 80 m), `bicycle: push`                  |
| 6    | 1→6     | Steps, `bicycle: no`                                                           |
| 7    | 6→7     | "Test Walk" footway, wheelchair yes                                            |
| 8    | 2→7     | "Test Ramp" footway, wheelchair yes (step-free alternative to the steps)       |
| 9    | 7→8     | 140 m of steps, `bicycle: push` — the only link to the south                   |
| 10   | 8→9     | "South Test Path", wheelchair unknown                                          |
| 11   | 0→7     | "Test Cycleway", `foot: false`, bicycle ride                                   |

Used for: walking ignoring vehicle one-way, cycling respecting it (pushes
round the loop instead), `foot=false` exclusion, steps avoidance, step-free
`no-path` when only steps reach the destination, push-bike caveats.
