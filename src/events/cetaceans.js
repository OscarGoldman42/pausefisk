import { Color3, MeshBuilder, Scalar, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { FLOOR_Y, aquarium } from "../aquarium.js";
import { buildCreature, curve, lerpColor, mirrorZ } from "./creature.js";
import { createPuffTexture } from "./common.js";

// Hval, delfiner og spækhuggere. Kroppene bygges af creature.js og peger med snuden mod +X.

// Små mørke øjne på begge sider af hovedet (hovedet bølger ikke med, så de kan sidde fast på kroppen)
function addEyes(scene, body, [x, y, z], diameter) {
  const mat = new StandardMaterial(`${body.name}Eye`, scene);
  mat.diffuseColor = new Color3(0.02, 0.02, 0.03);
  mat.specularColor = new Color3(0.6, 0.6, 0.6);
  for (const side of [-1, 1]) {
    const eye = MeshBuilder.CreateSphere(`${body.name}Eye`, { diameter, segments: 4 }, scene);
    eye.material = mat;
    eye.parent = body;
    eye.position.set(x, y, side * z);
  }
}

// Drej en node, så snuden (+X) peger i farten
function orient(node, v) {
  const speed = v.length();
  if (speed < 0.01) return;
  node.rotation.y = Math.atan2(-v.z, v.x);
  node.rotation.z = Math.asin(Scalar.Clamp(v.y / speed, -0.9, 0.9));
}

// ---------- Pukkelhval ----------
// Glider meget langsomt forbi højt oppe i disen. Dens skygge driver hen over sandet,
// og lysstrålerne dæmpes, mens den er over scenen.
const WHALE_DARK = [0.16, 0.2, 0.26];
const WHALE_BELLY = [0.62, 0.65, 0.68];
const WHALE_GROOVE = [0.42, 0.45, 0.5];

function whaleColor({ part, t, v, j }) {
  if (part === "flipper") return [0.7, 0.73, 0.76]; // pukkelhvalens lyse luffer
  if (part !== "body") return WHALE_DARK;
  if (v < -0.45) return t < 0.5 && j % 2 ? WHALE_GROOVE : WHALE_BELLY; // furer under hagen og bugen
  return lerpColor(WHALE_DARK, [0.3, 0.34, 0.4], (-v + 0.2) * 0.8);
}

function buildWhale(scene) {
  // Luffen: bred ved roden, smal og afrundet i spidsen; mørk ovenpå og lys på undersiden
  const flipper = {
    part: "fin",
    underside: "flipper",
    thickness: [0, 0.007, 0],
    points: [[0.3, -0.06, 0.09], [0.21, -0.08, 0.1], [0.11, -0.11, 0.2], [0.08, -0.12, 0.25], [0.12, -0.11, 0.255], [0.17, -0.09, 0.21]],
  };
  const fluke = {
    part: "fin",
    thickness: [0, 0.006, 0],
    points: [[-0.44, 0, 0.01], [-0.5, 0.01, 0.2], [-0.58, 0.01, 0.24], [-0.54, 0, 0.03]],
  };
  return buildCreature(scene, "whale", {
    profile: curve([[0, 0.04], [0.05, 0.08], [0.12, 0.11], [0.25, 0.13], [0.4, 0.125], [0.6, 0.09], [0.78, 0.05], [0.9, 0.028], [1, 0.012]]),
    height: 0.85,
    width: (t) => (t > 0.75 ? 1.05 - (t - 0.75) * 1.6 : 1.05),
    centerY: (t) => (t < 0.15 ? -0.015 * (1 - t / 0.15) : 0),
    segments: 16,
    fins: [
      flipper,
      mirrorZ(flipper),
      fluke,
      mirrorZ(fluke),
      { part: "fin", thickness: [0, 0, 0.01], points: [[-0.1, 0.075, 0], [-0.16, 0.11, 0], [-0.2, 0.07, 0]] },
    ],
    color: whaleColor,
  });
}

export function createWhale(scene, { water }) {
  const root = new TransformNode("rareWhale", scene);
  const whale = buildWhale(scene);
  whale.parent = root;
  addEyes(scene, whale, [0.33, -0.035, 0.112], 0.012);
  root.scaling.setAll(18);
  root.setEnabled(false);

  // Blød skygge på bunden under hvalen
  const shadowMat = new StandardMaterial("whaleShadow", scene);
  shadowMat.diffuseTexture = createPuffTexture(scene);
  shadowMat.diffuseTexture.hasAlpha = true;
  shadowMat.useAlphaFromDiffuseTexture = true;
  shadowMat.diffuseColor = Color3.Black();
  shadowMat.specularColor = Color3.Black();
  shadowMat.disableLighting = true;
  shadowMat.alpha = 0.45;
  shadowMat.zOffset = -2; // tegnes oven på sandet uden at flimre
  const shadow = MeshBuilder.CreateGround("whaleShadowMesh", { width: 20, height: 7 }, scene);
  shadow.material = shadowMat;
  shadow.parent = null;
  shadow.isPickable = false;
  shadow.setEnabled(false);

  const SPEED = 1.15;
  const velocity = new Vector3();
  let t = 0;
  let dir = 1;
  let baseY = 0;

  return {
    roots: [root],
    ready: true,
    done: false,
    start() {
      t = 0;
      this.done = false;
      dir = Math.random() < 0.5 ? 1 : -1;
      baseY = Scalar.RandomRange(6.5, 8);
      root.position.set(-dir * 48, baseY, Scalar.RandomRange(20, 23));
      root.setEnabled(true);
      shadow.setEnabled(true);
    },
    update(dt) {
      t += dt;
      velocity.set(dir * SPEED, Math.cos(t * 0.12) * 0.12, 0);
      root.position.addInPlace(velocity.scale(dt));
      orient(root, velocity);
      root.rotation.x = Math.sin(t * 0.2) * 0.04; // et roligt rul
      whale.swim(t * 0.9, 0.03);

      const p = root.position;
      shadow.position.set(p.x - dir * 2, FLOOR_Y + 0.2, p.z - 2);
      const overhead = Math.exp(-((p.x / 18) ** 2)); // 1 når hvalen er midt over scenen
      water.setLightScale(1 - 0.35 * overhead);
      shadowMat.alpha = 0.6 * overhead + 0.15;
      this.done = p.x * dir > 50;
    },
    stop() {
      root.setEnabled(false);
      shadow.setEnabled(false);
      water.setLightScale(1);
    },
  };
}

// ---------- Delfiner ----------
// En flok på fem kommer hurtigt ind i buer. Er stimen der, cirkler de om den og skyder igennem,
// så den splitter op (de er "trusler" ligesom hajen); ellers fortsætter de bare forbi.
function dolphinColor({ part, v }) {
  if (part !== "body") return [0.36, 0.43, 0.5];
  if (v < -0.35) return [0.86, 0.87, 0.88];
  return lerpColor([0.36, 0.43, 0.5], [0.58, 0.63, 0.68], (0.4 - v) * 1.2);
}

function buildDolphin(scene, name) {
  const pectoral = { part: "fin", thickness: [0, 0.008, 0], points: [[0.24, -0.06, 0.08], [0.17, -0.07, 0.08], [0.09, -0.13, 0.19]] };
  const fluke = { part: "fin", thickness: [0, 0.006, 0], points: [[-0.43, 0, 0.01], [-0.5, 0.005, 0.15], [-0.56, 0.005, 0.15], [-0.53, 0, 0.02]] };
  return buildCreature(scene, name, {
    profile: curve([[0, 0.012], [0.04, 0.028], [0.08, 0.045], [0.12, 0.075], [0.2, 0.1], [0.35, 0.112], [0.5, 0.095], [0.7, 0.055], [0.85, 0.03], [0.95, 0.02], [1, 0.01]]),
    width: (t) => (t > 0.7 ? 0.85 - (t - 0.7) * 1.3 : 0.85),
    centerY: (t) => -0.025 * Math.max(0, 1 - t / 0.14), // næbet sidder lidt lavere end panden
    fins: [
      pectoral,
      mirrorZ(pectoral),
      fluke,
      mirrorZ(fluke),
      { part: "fin", thickness: [0, 0, 0.012], points: [[0.08, 0.09, 0], [0.02, 0.15, 0], [-0.1, 0.22, 0], [-0.07, 0.14, 0], [-0.08, 0.085, 0]] },
    ],
    color: dolphinColor,
  });
}

export function createDolphins(scene) {
  const pod = Array.from({ length: 5 }, (_, i) => {
    const root = new TransformNode(`rareDolphin${i}`, scene);
    const body = buildDolphin(scene, `dolphin${i}`);
    body.parent = root;
    addEyes(scene, body, [0.37, 0.0, 0.064], 0.016);
    root.scaling.setAll(Scalar.RandomRange(3, 3.5));
    root.setEnabled(false);
    const velocity = new Vector3();
    return { root, body, velocity, threat: { position: root.position, radius: 3, velocity }, phase: Math.random() * 6, seed: Math.random() * 10 };
  });

  const target = new Vector3();
  let t = 0;
  let dir = 1;
  let hunt = null; // stimens midtpunkt, hvis de jager
  let dashTimer = 0;
  let dasher = -1;

  return {
    roots: pod.map((d) => d.root),
    ready: true,
    done: false,
    start() {
      t = 0;
      this.done = false;
      dir = Math.random() < 0.5 ? 1 : -1;
      hunt = aquarium.mode === "normal" && aquarium.schoolCenter ? aquarium.schoolCenter : null;
      dashTimer = 2;
      pod.forEach((d, i) => {
        d.root.position.set(-dir * (42 + i * 3), Scalar.RandomRange(1, 5), Scalar.RandomRange(5, 12));
        d.velocity.set(dir * 7, 0, 0);
        d.root.setEnabled(true);
        aquarium.threats.push(d.threat);
      });
    },
    update(dt) {
      t += dt;
      const leaving = !hunt || t > 22;
      dashTimer -= dt;
      if (dashTimer <= 0) {
        dasher = Math.floor(Math.random() * pod.length);
        dashTimer = Scalar.RandomRange(2, 3.5);
      }
      let out = true;
      pod.forEach((d, i) => {
        const p = d.root.position;
        let speed = 7;
        if (leaving) {
          // Videre ud til den anden side i bløde buer
          target.set(dir * 70, 4 + Math.sin(t * 1.2 + d.seed) * 3, 8 + i);
        } else if (i === dasher && dashTimer > 1.2) {
          target.copyFrom(hunt); // skyder lige igennem stimen
          speed = 9;
        } else {
          // Cirkler om stimen i forskellige højder
          const a = t * 0.9 + (i / pod.length) * Math.PI * 2;
          target.set(hunt.x + Math.cos(a) * 6, hunt.y + Math.sin(a * 1.3 + d.seed) * 2, hunt.z + Math.sin(a) * 4);
        }
        target.z = Math.max(target.z, 5); // ikke helt op i kameraet
        const desired = target.subtract(p).normalize().scaleInPlace(speed);
        Vector3.LerpToRef(d.velocity, desired, Math.min(1, dt * 1.6), d.velocity);
        p.addInPlace(d.velocity.scale(dt));
        p.y = Math.max(p.y, FLOOR_Y + 2);
        p.z = Math.max(p.z, 2);
        orient(d.root, d.velocity);
        d.phase += dt * (3 + d.velocity.length() * 0.8);
        d.body.swim(d.phase, 0.06);
        if (p.x * dir < 60) out = false;
      });
      this.done = leaving && out;
    },
    stop() {
      for (const d of pod) {
        d.root.setEnabled(false);
        const i = aquarium.threats.indexOf(d.threat);
        if (i >= 0) aquarium.threats.splice(i, 1);
      }
    },
  };
}

// ---------- Spækhuggere ----------
// En mor og hendes unge glider tungt forbi i mellemhøjde. Fiskene viger langt væk.
const ORCA_BLACK = [0.05, 0.06, 0.08];
const ORCA_WHITE = [0.9, 0.91, 0.92];

function orcaColor({ part, t, v }) {
  if (part !== "body") return ORCA_BLACK;
  if (t > 0.12 && t < 0.24 && v > 0.15 && v < 0.55) return ORCA_WHITE; // øjepletten
  if (t > 0.42 && t < 0.56 && v > 0.75) return [0.42, 0.44, 0.48]; // den grå "sadel" bag finnen
  if (t > 0.03 && t < 0.6 && v < -0.45) return ORCA_WHITE; // hage og bug
  if (t >= 0.55 && t < 0.75 && v < -0.1 + (t - 0.55) * 1.5) return ORCA_WHITE; // flanken der svinger op
  return ORCA_BLACK;
}

function buildOrca(scene, name, dorsalHeight) {
  const pectoral = { part: "fin", thickness: [0, 0.01, 0], points: [[0.27, -0.08, 0.1], [0.19, -0.1, 0.1], [0.06, -0.16, 0.25], [0.14, -0.17, 0.27]] };
  const fluke = { part: "fin", underside: "belly", thickness: [0, 0.007, 0], points: [[-0.43, 0, 0.01], [-0.5, 0.005, 0.17], [-0.57, 0.005, 0.16], [-0.53, 0, 0.02]] };
  return buildCreature(scene, name, {
    profile: curve([[0, 0.03], [0.04, 0.07], [0.1, 0.105], [0.2, 0.13], [0.35, 0.14], [0.5, 0.125], [0.7, 0.075], [0.85, 0.04], [0.95, 0.025], [1, 0.012]]),
    width: (t) => (t > 0.7 ? 0.95 - (t - 0.7) * 1.4 : 0.95),
    segments: 16,
    fins: [
      pectoral,
      mirrorZ(pectoral),
      fluke,
      mirrorZ(fluke),
      { part: "fin", thickness: [0, 0, 0.014], points: [[0.05, 0.12, 0], [-0.03, 0.12 + dorsalHeight, 0], [-0.09, 0.11, 0]] },
    ],
    color: (info) => (info.part === "belly" ? ORCA_WHITE : orcaColor(info)),
  });
}

export function createOrcas(scene) {
  const make = (name, length, dorsal) => {
    const root = new TransformNode(name, scene);
    const body = buildOrca(scene, `${name}Body`, dorsal);
    body.parent = root;
    addEyes(scene, body, [0.39, 0.012, 0.095], 0.014);
    root.scaling.setAll(length);
    root.setEnabled(false);
    const velocity = new Vector3();
    return { root, body, velocity, threat: { position: root.position, radius: length * 0.9, velocity }, phase: 0 };
  };
  const mother = make("rareOrca", 7.5, 0.24);
  const calf = make("rareOrcaCalf", 3.6, 0.12);
  const pair = [mother, calf];

  const SPEED = 2.8;
  let t = 0;
  let dir = 1;
  let baseY = 0;
  let baseZ = 0;
  const calfOffset = new Vector3();

  return {
    roots: pair.map((o) => o.root),
    ready: true,
    done: false,
    start() {
      t = 0;
      this.done = false;
      dir = Math.random() < 0.5 ? 1 : -1;
      baseY = Scalar.RandomRange(1, 4);
      baseZ = Scalar.RandomRange(10, 14);
      mother.root.position.set(-dir * 45, baseY, baseZ);
      for (const o of pair) {
        o.root.setEnabled(true);
        aquarium.threats.push(o.threat);
      }
      calf.root.position.copyFrom(mother.root.position);
    },
    update(dt) {
      t += dt;
      // Moren følger en blød bølge; ungen holder sig lidt bag og over hende og svømmer hurtigere med halen
      mother.velocity.set(dir * SPEED, Math.cos(t * 0.35) * 0.5, Math.sin(t * 0.2) * 0.3);
      mother.root.position.addInPlace(mother.velocity.scale(dt));
      calfOffset.set(-dir * 5, 1.6 + Math.sin(t * 0.5) * 0.4, -2);
      const goal = mother.root.position.add(calfOffset);
      // Morens fart plus et blødt træk hen mod pladsen ved hendes side
      calf.velocity.copyFrom(goal.subtract(calf.root.position).scaleInPlace(1.2).addInPlace(mother.velocity));
      calf.root.position.addInPlace(calf.velocity.scale(dt));
      for (const o of pair) orient(o.root, o.velocity);
      mother.phase += dt * 2.2;
      calf.phase += dt * 3.4;
      mother.body.swim(mother.phase, 0.045);
      calf.body.swim(calf.phase, 0.055);
      this.done = calf.root.position.x * dir > 50;
    },
    stop() {
      for (const o of pair) {
        o.root.setEnabled(false);
        const i = aquarium.threats.indexOf(o.threat);
        if (i >= 0) aquarium.threats.splice(i, 1);
      }
    },
  };
}
