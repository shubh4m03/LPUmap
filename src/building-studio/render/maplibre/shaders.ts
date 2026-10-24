/**
 * GLSL ES 3.00 sources for the studio custom layer (raw WebGL2, S1).
 *
 * Lighting reproduces MapLibre 6.15's fill-extrusion formula (ambient 0.03,
 * `mix(1 − I, max(1 − luminance + I, 1), directional)`, light-colour clamp
 * and the vertical gradient on walls), so a studio model and the OSM
 * extrusions beside it are shaded by the same map-anchored light.
 *
 * Window patterns are procedural and synthetic (S3: no photographic
 * textures): a cell grid in wall metres (bay width × floor height) with an
 * opening per cell whose size depends on the pattern and density. Edges are
 * antialiased with fwidth, and when a cell shrinks below about two pixels the
 * pattern fades to its average coverage so distant façades do not shimmer.
 */
import type { ATTRIBUTES } from './buffers.ts';

export const ATTRIBUTE_LOCATIONS = {
  position: 0,
  normal: 1,
  colour: 2,
  uv: 3,
  grid: 4,
  pattern: 5,
} as const satisfies Record<keyof typeof ATTRIBUTES, number>;

export const VERTEX_SHADER = `#version 300 es
precision highp float;
uniform mat4 u_matrix;
uniform vec3 u_lightpos;
uniform float u_lightintensity;
uniform vec2 u_zrange;
layout(location=0) in vec3 a_pos;
layout(location=1) in vec3 a_normal;
layout(location=2) in vec3 a_colour;
layout(location=3) in vec2 a_uv;
layout(location=4) in vec4 a_grid;
layout(location=5) in vec2 a_pattern;
out vec3 v_colour;
out float v_directional;
out float v_gradient;
out vec2 v_uv;
out vec4 v_grid;
out vec2 v_pattern;
void main() {
  gl_Position = u_matrix * vec4(a_pos, 1.0);
  v_colour = a_colour;
  v_directional = clamp(dot(a_normal, u_lightpos), 0.0, 1.0);
  float height = max(u_zrange.y, 0.0);
  float t = height > u_zrange.x ? clamp((a_pos.z - u_zrange.x) / (height - u_zrange.x), 0.0, 1.0) : 1.0;
  float gradient = clamp((t + max(u_zrange.x, 0.0)) * pow(height / 150.0, 0.5), mix(0.7, 0.98, 1.0 - u_lightintensity), 1.0);
  v_gradient = abs(a_normal.z) < 0.001 ? gradient : 1.0;
  v_uv = a_uv;
  v_grid = a_grid;
  v_pattern = a_pattern;
}
`;

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec3 u_lightcolor;
uniform float u_lightintensity;
uniform vec3 u_glass;
uniform float u_alpha;
uniform float u_highlight;
uniform vec3 u_highlightcolour;
in vec3 v_colour;
in float v_directional;
in float v_gradient;
in vec2 v_uv;
in vec4 v_grid;
in vec2 v_pattern;
out vec4 fragColor;

vec3 shade(vec3 c) {
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c += vec3(0.03);
  float d = mix(1.0 - u_lightintensity, max(1.0 - lum + u_lightintensity, 1.0), v_directional) * v_gradient;
  return clamp(c * d * u_lightcolor, mix(vec3(0.0), vec3(0.3), vec3(1.0) - u_lightcolor), vec3(1.0));
}

float band(float x, float a, float b, float aa) {
  return smoothstep(a - aa, a + aa, x) * (1.0 - smoothstep(b - aa, b + aa, x));
}

float windowMask() {
  float pattern = v_pattern.x;
  if (pattern < 0.5) return 0.0;
  float floorH = max(v_grid.x, 0.1);
  float bay = max(v_grid.z, 0.1);
  float density = clamp(v_grid.w, 0.0, 1.0);
  float vv = v_uv.y - v_grid.y;
  if (vv < 0.0 || vv > v_pattern.y * floorH) return 0.0;
  vec2 cell = vec2(v_uv.x / bay, vv / floorH);
  vec2 f = fract(cell);
  vec2 aa = max(fwidth(cell), vec2(1e-4));
  float w; float h0; float h1;
  if (pattern < 1.5) { w = 0.97; h0 = 0.32; h1 = 0.32 + 0.55 * density; }
  else if (pattern < 2.5) { w = 0.25 + 0.45 * density; h0 = 0.3; h1 = 0.3 + 0.5 * density; }
  else if (pattern < 3.5) { w = 0.55 + 0.35 * density; h0 = 0.18; h1 = 0.18 + 0.7 * density; }
  else { w = 0.92; h0 = 0.05; h1 = 0.95; }
  float mask = band(f.x, 0.5 - 0.5 * w, 0.5 + 0.5 * w, aa.x) * band(f.y, h0, h1, aa.y);
  float coverage = w * (h1 - h0);
  return mix(mask, coverage, smoothstep(0.25, 0.5, max(aa.x, aa.y)));
}

void main() {
  vec3 colour = shade(v_colour);
  float m = windowMask();
  if (m > 0.0) colour = mix(colour, shade(u_glass), m);
  colour = mix(colour, u_highlightcolour, 0.45 * u_highlight);
  fragColor = vec4(colour * u_alpha, u_alpha);
}
`;

export const UNIFORMS = [
  'u_matrix',
  'u_lightpos',
  'u_lightintensity',
  'u_lightcolor',
  'u_zrange',
  'u_glass',
  'u_alpha',
  'u_highlight',
  'u_highlightcolour',
] as const;
export type UniformName = (typeof UNIFORMS)[number];
