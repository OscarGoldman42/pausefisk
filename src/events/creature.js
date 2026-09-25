import { Color3, Mesh, StandardMaterial, VertexData } from "@babylonjs/core";
import { CausticsPlugin } from "../caustics.js";

// Bygger et lavpolygon-dyr (hval, delfin, spækhugger) som ét mesh med flade facetter og farver pr. facet.
// Kroppen ligger langs X med snuden ved +0.5 og halen ved -0.5 (længde 1; skaler noden bagefter).
// Tværsnittet er en ellipse med radius `profile(t)`, hvor t går fra 0 ved snuden til 1 ved halen.
// Finner er flade polygoner med lidt tykkelse. `color({ part, t, v })` giver facettens farve,
// hvor v er -1 under bugen og 1 oven på ryggen.
export function buildCreature(scene, name, spec) {
  const { profile, height = 1, width = 1, centerY = () => 0, rings = 28, segments = 14, fins = [], color } = spec;
  const positions = [];
  const colors = [];
  const tri = (a, b, c, rgb) => {
    positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) colors.push(rgb[0], rgb[1], rgb[2], 1);
  };

  // Krop: ringe af punkter langs X
  const ring = [];
  for (let k = 0; k <= rings; k++) {
    const t = k / rings;
    const r = profile(t);
    const w = typeof width === "function" ? width(t) : width;
    const points = [];
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      points.push([0.5 - t, centerY(t) + Math.sin(a) * r * height, Math.cos(a) * r * w]);
    }
    ring.push(points);
  }
  for (let k = 0; k < rings; k++) {
    const t = (k + 0.5) / rings;
    for (let j = 0; j < segments; j++) {
      const j2 = (j + 1) % segments;
      const v = Math.sin(((j + 0.5) / segments) * Math.PI * 2);
      const rgb = color({ part: "body", t, v, j });
      tri(ring[k][j], ring[k + 1][j], ring[k + 1][j2], rgb);
      tri(ring[k][j], ring[k + 1][j2], ring[k][j2], rgb);
    }
  }
  // Luk halespidsen
  const tail = [-0.5, centerY(1), 0];
  for (let j = 0; j < segments; j++) tri(ring[rings][j], tail, ring[rings][(j + 1) % segments], color({ part: "body", t: 1, v: 0, j }));

  // Finner: polygon (vifte fra første punkt) forskudt ± `thickness` til begge sider, plus kanterne
  for (const fin of fins) {
    const pts = fin.points;
    const off = fin.thickness;
    const up = pts.map((p) => [p[0] + off[0], p[1] + off[1], p[2] + off[2]]);
    const down = pts.map((p) => [p[0] - off[0], p[1] - off[1], p[2] - off[2]]);
    const rgb = color({ part: fin.part, t: 0.5, v: 1 });
    const under = fin.underside ? color({ part: fin.underside, t: 0.5, v: -1 }) : rgb;
    for (let i = 1; i < pts.length - 1; i++) {
      tri(up[0], up[i], up[i + 1], rgb);
      tri(down[0], down[i + 1], down[i], under);
    }
    for (let i = 0; i < pts.length; i++) {
      const i2 = (i + 1) % pts.length;
      tri(up[i], down[i], down[i2], rgb);
      tri(up[i], down[i2], up[i2], rgb);
    }
  }

  const mesh = flatMesh(scene, name, positions, colors);
  // Svømning: kroppen bølger op og ned, mest mod halen (hvaler slår med halen lodret, ikke fra side til side)
  mesh.swim = (phase, amplitude) =>
    mesh.deform((x) => {
      const back = Math.min(1, Math.max(0, (0.2 - x) / 0.7)); // 0 foran, 1 ved halen
      return amplitude * (back * back * Math.sin(phase - (0.5 - x) * 4) - 0.12 * Math.sin(phase));
    });
  return mesh;
}

// Mesh af løse trekanter (flade facetter i lavpolygon-stil) med en farve pr. hjørne.
// `mesh.deform(fn)` flytter hvert hjørne lodret med fn(x, y, z) ud fra den oprindelige form.
export function flatMesh(scene, name, positions, colors) {
  const indices = Array.from({ length: positions.length / 3 }, (_, i) => i);
  const normals = [];
  VertexData.ComputeNormals(positions, indices, normals);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = normals;
  data.colors = colors;
  const mesh = new Mesh(name, scene);
  data.applyToMesh(mesh, true);

  const mat = new StandardMaterial(`${name}Mat`, scene);
  mat.diffuseColor = Color3.White(); // farverne ligger i facetterne
  mat.ambientColor = new Color3(0.55, 0.55, 0.55);
  mat.specularColor = new Color3(0.12, 0.12, 0.12);
  mat.backFaceCulling = false;
  mat.twoSidedLighting = true;
  new CausticsPlugin(mat, { caustics: 0.3, rim: 0.25 });
  mesh.material = mat;

  const base = Float32Array.from(positions);
  const moved = Float32Array.from(positions);
  const movedNormals = new Float32Array(positions.length);
  mesh.deform = (fn) => {
    for (let i = 0; i < base.length; i += 3) moved[i + 1] = base[i + 1] + fn(base[i], base[i + 1], base[i + 2]);
    VertexData.ComputeNormals(moved, indices, movedNormals);
    mesh.updateVerticesData("position", moved);
    mesh.updateVerticesData("normal", movedNormals);
  };
  return mesh;
}

// Stykkevis lineær kurve gennem [t, værdi]-punkter
export function curve(points) {
  return (t) => {
    for (let i = 1; i < points.length; i++) {
      if (t <= points[i][0]) {
        const [t0, v0] = points[i - 1];
        const [t1, v1] = points[i];
        return v0 + ((v1 - v0) * (t - t0)) / (t1 - t0);
      }
    }
    return points[points.length - 1][1];
  };
}

// Spejl en finne til den anden side (z → -z)
export function mirrorZ(fin) {
  return { ...fin, points: fin.points.map(([x, y, z]) => [x, y, -z]) };
}

export const lerpColor = (a, b, f) => a.map((c, i) => c + (b[i] - c) * Math.min(1, Math.max(0, f)));
