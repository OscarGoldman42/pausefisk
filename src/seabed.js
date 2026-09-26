import {
  Color3,
  Mesh,
  MeshBuilder,
  MaterialPluginBase,
  Quaternion,
  Scalar,
  StandardMaterial,
  Vector3,
  VertexData,
} from "@babylonjs/core";
import { CausticsPlugin, causticClock } from "./caustics.js";

// Havbund med liv: koraller, søanemoner, vifter og søstjerner bygget af simple former,
// plus sandriller. Hver type bygges én gang og genbruges som instanser, så det er billigt at tegne.

// ---------- Material-plugins ----------

// Får anemonernes tentakler og vifterne til at vaje i strømmen. Sker i vertex-shaderen,
// så det koster næsten ingenting. Jo højere oppe på modellen, jo mere vajer den.
export class SwayPlugin extends MaterialPluginBase {
  constructor(material, { strength = 0.08, speed = 1.2 } = {}) {
    super(material, "Sway", 210, { PF_SWAY: false });
    this.strength = strength;
    this.speed = speed;
    this._enable(true);
  }
  prepareDefines(defines) {
    defines.PF_SWAY = true;
  }
  getClassName() {
    return "SwayPlugin";
  }
  getUniforms() {
    return {
      ubo: [
        { name: "pfSwayTime", size: 1, type: "float" },
        { name: "pfSwayStrength", size: 1, type: "float" },
        { name: "pfSwaySpeed", size: 1, type: "float" },
      ],
      vertex: `#ifdef PF_SWAY
        uniform float pfSwayTime;
        uniform float pfSwayStrength;
        uniform float pfSwaySpeed;
      #endif`,
    };
  }
  bindForSubMesh(uniformBuffer) {
    uniformBuffer.updateFloat("pfSwayTime", causticClock.time);
    uniformBuffer.updateFloat("pfSwayStrength", this.strength);
    uniformBuffer.updateFloat("pfSwaySpeed", this.speed);
  }
  getCustomCode(shaderType) {
    if (shaderType !== "vertex") return null;
    return {
      CUSTOM_VERTEX_UPDATE_WORLDPOS: `#ifdef PF_SWAY
        float pfH = max(positionUpdated.y, 0.0);
        float pfW = pfH * pfH * pfSwayStrength;
        vec2 pfSeed = finalWorld[3].xz; // hver instans får sin egen rytme
        // Fasen afhænger også af punktets plads i modellen, så tentakler/blade ikke bevæger sig i takt
        float pfPhase = pfSeed.x * 0.7 + pfSeed.y * 0.9 + positionUpdated.x * 1.3 + positionUpdated.z * 1.1;
        worldPos.x += sin(pfSwayTime * pfSwaySpeed + pfPhase + pfH * 1.6) * pfW;
        worldPos.z += cos(pfSwayTime * pfSwaySpeed * 0.8 + pfPhase * 1.3 + pfH * 1.3) * pfW * 0.7;
      #endif`,
    };
  }
}

// Sandriller: bølgede riller i sandet via lyset (normalen) og lidt mørkere render.
// Tones ud på afstand, så de ikke flimrer.
export class SandRipplePlugin extends MaterialPluginBase {
  constructor(material) {
    super(material, "SandRipple", 220, { PF_SAND: false });
    this._enable(true);
  }
  prepareDefines(defines) {
    defines.PF_SAND = true;
  }
  getClassName() {
    return "SandRipplePlugin";
  }
  getCustomCode(shaderType) {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef PF_SAND
        // Riller på tværs af bunden, der bugter sig lidt
        float pfRipplePhase(vec2 q) { return q.x * 0.35 + q.y * 2.1 + sin(q.x * 0.23) * 2.0 + sin(q.x * 0.61 + q.y * 0.2) * 0.8; }
        float pfRippleFade(vec3 p) { return clamp(1.0 - length(p - vEyePosition.xyz) / 70.0, 0.0, 1.0); }
      #endif`,
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#ifdef PF_SAND
        float pfR = sin(pfRipplePhase(vPositionW.xz));
        baseColor.rgb *= 1.0 + pfR * 0.07 * pfRippleFade(vPositionW);
      #endif`,
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: `#ifdef PF_SAND
        float pfSlope = cos(pfRipplePhase(vPositionW.xz)) * 0.35 * pfRippleFade(vPositionW);
        normalW = normalize(normalW + vec3(-0.17 * pfSlope, 0.0, -pfSlope));
      #endif`,
    };
  }
}

// ---------- Byggeklodser ----------

function colorize(mesh, colorAt) {
  const pos = mesh.getVerticesData("position");
  const colors = [];
  for (let i = 0; i < pos.length; i += 3) {
    const c = colorAt(pos[i], pos[i + 1], pos[i + 2]);
    colors.push(c.r, c.g, c.b, 1);
  }
  mesh.setVerticesData("color", colors);
  return mesh;
}

function merge(parts, name) {
  const mesh = Mesh.MergeMeshes(parts, true, true);
  mesh.name = name;
  mesh.isPickable = false;
  mesh.setEnabled(false); // kun skabelon – det er instanserne der vises
  return mesh;
}

// Placér et segment (cylinder) fra `start` i retning `dir`
const UP = new Vector3(0, 1, 0);
function segment(scene, start, dir, length, rBottom, rTop, tessellation = 6) {
  const cyl = MeshBuilder.CreateCylinder("seg", { height: length, diameterBottom: rBottom * 2, diameterTop: rTop * 2, tessellation }, scene);
  cyl.rotationQuaternion = new Quaternion();
  Quaternion.FromUnitVectorsToRef(UP, dir, cyl.rotationQuaternion);
  cyl.position = start.add(dir.scale(length / 2));
  return cyl;
}

function randomTilt(dir, amount) {
  return dir.add(new Vector3(Scalar.RandomRange(-amount, amount), 0, Scalar.RandomRange(-amount, amount))).normalize();
}

// Grenkoral: forgrener sig et par gange, lysere mod spidserne
function buildBranchCoral(scene, base, tip) {
  const parts = [];
  const grow = (start, dir, length, radius, depth) => {
    const seg = segment(scene, start, dir, length, radius, radius * 0.72);
    const k = 1 - depth / 4;
    colorize(seg, () => Color3.Lerp(base, tip, k));
    parts.push(seg);
    const end = start.add(dir.scale(length));
    if (depth === 0) {
      const knob = MeshBuilder.CreateSphere("knob", { diameter: radius * 1.9, segments: 4 }, scene);
      knob.position = end;
      parts.push(colorize(knob, () => tip));
      return;
    }
    const branches = depth === 3 ? 3 : Scalar.RandomRange(0, 1) < 0.5 ? 2 : 3;
    for (let i = 0; i < branches; i++) {
      grow(end, randomTilt(dir.add(new Vector3(0, 0.6, 0)), 0.9), length * 0.78, radius * 0.72, depth - 1);
    }
  };
  grow(Vector3.Zero(), UP, 0.55, 0.13, 3);
  return merge(parts, "branchCoral");
}

// Hjernekoral: fladtrykt kugle med bugtede riller
function buildBrainCoral(scene, light, dark) {
  const mesh = MeshBuilder.CreateIcoSphere("brain", { radius: 1, subdivisions: 4, updatable: true }, scene);
  const pos = mesh.getVerticesData("position");
  const colors = [];
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    const groove = Math.sin(x * 9 + Math.sin(z * 5) * 2.2) * Math.sin(z * 9 + Math.sin(x * 4) * 2.2);
    const r = 1 + groove * 0.05;
    pos[i] = x * r;
    pos[i + 1] = Math.max(y * r * 0.62, -0.05);
    pos[i + 2] = z * r;
    const c = Color3.Lerp(dark, light, groove * 0.5 + 0.5);
    colors.push(c.r, c.g, c.b, 1);
  }
  mesh.setVerticesData("position", pos);
  mesh.setVerticesData("color", colors);
  const normals = [];
  VertexData.ComputeNormals(pos, mesh.getIndices(), normals);
  mesh.setVerticesData("normal", normals);
  return merge([mesh], "brainCoral");
}

// Rørsvamp: en klynge åbne rør i forskellig højde
function buildTubeSponge(scene, outside, rim) {
  const parts = [];
  const count = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    const h = Scalar.RandomRange(0.6, 1.6);
    const tube = MeshBuilder.CreateCylinder("tube", {
      height: h,
      diameterBottom: Scalar.RandomRange(0.22, 0.32),
      diameterTop: Scalar.RandomRange(0.3, 0.42),
      tessellation: 10,
      cap: Mesh.CAP_START,
      sideOrientation: Mesh.DOUBLESIDE,
    }, scene);
    const angle = (i / count) * Math.PI * 2;
    tube.position.set(Math.cos(angle) * 0.25, h / 2, Math.sin(angle) * 0.25);
    tube.rotation.set(Math.sin(angle) * 0.18, 0, -Math.cos(angle) * 0.18);
    parts.push(colorize(tube, (x, y) => Color3.Lerp(outside, rim, Math.max(0, (y + h / 2) / h) ** 3)));
  }
  return merge(parts, "tubeSponge");
}

// Vifte (gorgonie): lodret halv-skive der vajer
function buildSeaFan(scene, base, edge) {
  const fan = MeshBuilder.CreateDisc("fan", { radius: 1.3, arc: 0.5, tessellation: 24, sideOrientation: Mesh.DOUBLESIDE }, scene);
  const stem = segment(scene, new Vector3(0, -0.3, 0), UP, 0.35, 0.06, 0.05);
  colorize(fan, (x, y) => Color3.Lerp(base, edge, Math.min(1, Math.hypot(x, y) / 1.3)));
  colorize(stem, () => base);
  return merge([fan, stem], "seaFan");
}

// Søanemone: kort fod med en krans af tentakler der vajer
function buildAnemone(scene, foot, tentacle, tip) {
  const parts = [];
  const body = MeshBuilder.CreateCylinder("anemoneFoot", { height: 0.45, diameterTop: 1.0, diameterBottom: 1.2, tessellation: 14 }, scene);
  body.position.y = 0.22;
  parts.push(colorize(body, () => foot));
  for (let i = 0; i < 46; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 0.45;
    const start = new Vector3(Math.cos(a) * r, 0.42, Math.sin(a) * r);
    const outward = new Vector3(Math.cos(a), 0, Math.sin(a)).scale(0.25 + r * 1.3);
    const dir = UP.add(outward).normalize();
    const len = Scalar.RandomRange(0.7, 1.2);
    const t = segment(scene, start, dir, len, 0.045, 0.02, 5);
    parts.push(colorize(t, (x, y) => Color3.Lerp(tentacle, tip, Math.max(0, Math.min(1, y / len + 0.5)))));
  }
  return merge(parts, "anemone");
}

// Søstjerne: fem arme, let hvælvet
function buildStarfish(scene, color) {
  const positions = [0, 0.1, 0];
  const indices = [];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const r = i % 2 === 0 ? 0.5 : 0.2;
    positions.push(Math.cos(a) * r, i % 2 === 0 ? 0.02 : 0.05, Math.sin(a) * r);
  }
  for (let i = 0; i < 10; i++) indices.push(0, 1 + ((i + 1) % 10), 1 + i);
  const mesh = new Mesh("starfish", scene);
  const data = new VertexData();
  data.positions = positions;
  data.indices = indices;
  data.normals = [];
  VertexData.ComputeNormals(positions, indices, data.normals);
  data.applyToMesh(mesh);
  colorize(mesh, (x, y, z) => Color3.Lerp(color, color.scale(0.6), Math.hypot(x, z) * 2));
  mesh.isPickable = false;
  mesh.setEnabled(false);
  return mesh;
}

// ---------- Opbygning ----------

const C = (r, g, b) => new Color3(r, g, b);

export function createSeabed(scene, { floorY }) {
  const reefMaterial = (name) => {
    const mat = new StandardMaterial(name, scene);
    mat.specularColor = new Color3(0.08, 0.08, 0.08);
    mat.backFaceCulling = false;
    mat.twoSidedLighting = true;
    return mat;
  };
  const staticMat = reefMaterial("reefMat");
  new CausticsPlugin(staticMat, { caustics: 0.4, rim: 0.12 });
  const swayMat = reefMaterial("reefSwayMat");
  new CausticsPlugin(swayMat, { caustics: 0.3, rim: 0.15 });
  new SwayPlugin(swayMat, { strength: 0.09, speed: 1.3 });

  const templates = {
    branch: [
      buildBranchCoral(scene, C(0.55, 0.18, 0.3), C(1.0, 0.55, 0.65)),
      buildBranchCoral(scene, C(0.6, 0.3, 0.1), C(1.0, 0.7, 0.35)),
      buildBranchCoral(scene, C(0.3, 0.15, 0.45), C(0.75, 0.55, 1.0)),
    ],
    brain: [buildBrainCoral(scene, C(0.75, 0.72, 0.45), C(0.38, 0.4, 0.2)), buildBrainCoral(scene, C(0.85, 0.55, 0.45), C(0.45, 0.25, 0.2))],
    tube: [buildTubeSponge(scene, C(0.8, 0.6, 0.12), C(1.0, 0.85, 0.35)), buildTubeSponge(scene, C(0.45, 0.2, 0.55), C(0.8, 0.5, 0.95))],
    fan: [buildSeaFan(scene, C(0.5, 0.1, 0.18), C(0.95, 0.35, 0.45)), buildSeaFan(scene, C(0.35, 0.12, 0.45), C(0.7, 0.45, 0.95))],
    anemone: [buildAnemone(scene, C(0.55, 0.3, 0.25), C(0.85, 0.35, 0.55), C(1.0, 0.8, 0.9)), buildAnemone(scene, C(0.3, 0.35, 0.25), C(0.45, 0.8, 0.5), C(0.9, 1.0, 0.7))],
    starfish: [buildStarfish(scene, C(0.95, 0.45, 0.15)), buildStarfish(scene, C(0.85, 0.2, 0.25)), buildStarfish(scene, C(0.55, 0.3, 0.75))],
  };
  for (const [type, list] of Object.entries(templates)) {
    for (const m of list) m.material = type === "anemone" || type === "fan" ? swayMat : staticMat;
  }

  const place = (type, x, z, scale, rotY = Math.random() * Math.PI * 2) => {
    const list = templates[type];
    const source = list[Math.floor(Math.random() * list.length)];
    const inst = source.createInstance(`${type}_${x.toFixed(1)}_${z.toFixed(1)}`);
    inst.position.set(x, floorY, z);
    inst.rotation.y = rotY;
    inst.scaling.setAll(scale);
    inst.isPickable = false;
    return inst;
  };

  // Rev-pletter i det synlige område. Hver plet får en anemone (hjem for klovnefiskene)
  const anemones = [];
  const patches = [
    [-13, 3], [-5, 9], [4, 1], [12, 7], [-10, 15], [8, 16],
  ];
  patches.forEach(([cx, cz], i) => {
    const around = (r) => [cx + Scalar.RandomRange(-r, r), cz + Scalar.RandomRange(-r, r)];
    if (i < 4) {
      const [x, z] = around(1);
      place("anemone", x, z, Scalar.RandomRange(1.1, 1.4));
      anemones.push(new Vector3(x, floorY + 1.6, z));
    }
    place("brain", ...around(2.5), Scalar.RandomRange(0.9, 1.5));
    for (let k = 0; k < 3; k++) place("branch", ...around(3), Scalar.RandomRange(1.4, 2.4));
    place("tube", ...around(3), Scalar.RandomRange(1.0, 1.6));
    if (Math.random() < 0.8) place("fan", ...around(3), Scalar.RandomRange(1.2, 1.9));
    for (let k = 0; k < 3; k++) place("starfish", ...around(4), Scalar.RandomRange(0.7, 1.2));
  });

  // Rev ude i siderne, så bunden ikke ser tom ud, når kameraet driver eller kigger derud
  const sidePatches = [
    [-19, -1], [-24, 7], [-31, 2], [-28, 15], [-37, 9],
    [19, 0], [24, 8], [31, 3], [28, 16], [37, 10],
  ];
  for (const [cx, cz] of sidePatches) {
    const around = (r) => [cx + Scalar.RandomRange(-r, r), cz + Scalar.RandomRange(-r, r)];
    if (Math.random() < 0.5) place("anemone", ...around(1.5), Scalar.RandomRange(1.0, 1.4));
    for (let k = 0; k < 2; k++) place("brain", ...around(3), Scalar.RandomRange(0.9, 1.6));
    for (let k = 0; k < 4; k++) place("branch", ...around(3.5), Scalar.RandomRange(1.3, 2.5));
    for (let k = 0; k < 2; k++) place("tube", ...around(3.5), Scalar.RandomRange(1.0, 1.7));
    if (Math.random() < 0.8) place("fan", ...around(3.5), Scalar.RandomRange(1.2, 2.0));
    for (let k = 0; k < 3; k++) place("starfish", ...around(4.5), Scalar.RandomRange(0.7, 1.2));
  }

  // Spredte koraller længere ude giver dybde
  const types = ["branch", "branch", "brain", "tube", "fan", "starfish"];
  for (let i = 0; i < 45; i++) {
    const type = types[Math.floor(Math.random() * types.length)];
    place(type, Scalar.RandomRange(-45, 45), Scalar.RandomRange(20, 50), Scalar.RandomRange(1.2, 2.6));
  }

  return { anemones };
}
