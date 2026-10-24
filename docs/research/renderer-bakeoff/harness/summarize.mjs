/**
 * Prints the Gate 3 result tables (Markdown) from the JSON the perf specs wrote.
 * Usage: node docs/research/renderer-bakeoff/harness/summarize.mjs [resultsDir]
 */
import fs from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] ?? path.resolve('docs/research/renderer-bakeoff/results');
const read = (name) => {
  const file = path.join(dir, `${name}.json`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};
const ms = (v) => (typeof v === 'number' ? v.toFixed(1) : '—');

console.log(
  '| Viewport | Path | Frames | rAF p50 ms | rAF p95 ms | max ms | > 50 ms | Layer CPU p95 ms | JS heap MB |',
);
console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
for (const vp of ['desktop', 'mobile'])
  for (const r of ['baseline', 'extrusion', 'custom', 'iso']) {
    const j = read(`${vp}-${r}`);
    if (!j) continue;
    const f = j.frames;
    const cpu = j.layerCpuMs && j.layerCpuMs.frames > 0 ? ms(j.layerCpuMs.p95) : '—';
    console.log(
      `| ${vp} | ${r} | ${f.frames} | ${ms(f.p50)} | ${ms(f.p95)} | ${ms(f.max)} | ${f.over50Pct} % | ${cpu} | ${ms(j.heapMB)} |`,
    );
  }

for (const vp of ['desktop', 'mobile']) {
  const iso = read(`${vp}-iso`);
  if (iso)
    console.log(
      `\n${vp} iso: initial scene build ${ms(iso.initial?.sceneBuildMs)} ms, full redraw ${ms(iso.initial?.fullRedrawMs)} ms (unthrottled); after a rotation at 4×: scene build ${ms(iso.afterRotate?.sceneBuildMs)} ms, full redraw ${ms(iso.afterRotate?.fullRedrawMs)} ms; ${iso.initial?.faces} faces.`,
    );
}

console.log('\n| Unthrottled reference (desktop) | rAF p50 | rAF p95 | Layer CPU p95 |');
console.log('| --- | ---: | ---: | ---: |');
for (const r of ['baseline', 'extrusion', 'custom']) {
  const j = read(`desktop-${r}-throttle1`);
  if (j)
    console.log(
      `| ${r} | ${ms(j.frames.p50)} | ${ms(j.frames.p95)} | ${j.layerCpuMs?.frames ? ms(j.layerCpuMs.p95) : '—'} |`,
    );
}

console.log('\n| Picking | Tilted (55°) | Top-down |');
console.log('| --- | ---: | ---: |');
for (const r of ['extrusion', 'custom', 'iso']) {
  const j = read(`picking-${r}`);
  if (j)
    console.log(
      `| ${r} | ${j.tilted.correct}/${j.tilted.total} | ${j.topDown ? `${j.topDown.correct}/${j.topDown.total}` : 'n/a'} |`,
    );
}

const c = read('context-loss-custom');
if (c)
  console.log(
    `\nContext loss: ${c.events.map((e) => `${e.step} @${e.ms} ms → ${e.state.r3d?.studio}${e.state.r3d?.fallbackReason ? ` (${e.state.r3d.fallbackReason})` : ''}`).join('; ')}. Recovered ${c.recoveredMs} ms after restore. Picks after restore ${c.pickAfterRestore.correct}/${c.pickAfterRestore.total}, on fallback ${c.pickOnFallback.correct}/${c.pickOnFallback.total}. Notices: ${c.notices.join(', ') || 'none'}.`,
  );
const w = read('watchdog-custom');
if (w)
  console.log(
    `Watchdog (4×, default budget): ${JSON.stringify({ studio: w.r3d?.studio, reason: w.r3d?.fallbackReason, level: w.r3d?.degradeLevel, notices: w.notices })}`,
  );
const d = read('detections-attribution');
if (d) console.log(`Detections attribution shown: "${d.shown}"; hidden: "${d.hidden}"`);
const l = read('lightcheck');
if (l) console.log(`Light check: ${JSON.stringify(l)}`);
