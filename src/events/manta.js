import { Color3, MeshBuilder, Scalar, TransformNode, Vector3 } from "@babylonjs/core";
import { aquarium } from "../aquarium.js";
import { material } from "./common.js";
import { flatMesh, lerpColor } from "./creature.js";

// En mantarokke glider forbi med langsomme vingeslag og slår en rolig kolbøtte midt i billedet.
// Kroppen er et gitter over vingefanget: tykkest i midten, tynd og spids ud mod vingespidserne.
// Snuden peger mod +X; vingerne ligger langs Z.

const SPAN = 30; // gitterfelter på tværs
const CHORD = 12; // gitterfelter fra for- til bagkant
const TIP = 0.95; // halvt vingefang

// Vingerne er strøget bagud som en halvmåne: buet forkant, indadbuet bagkant og spidser der peger bagud.
// Midt for er hovedet bredt og butsnudet. a = 0 i midten og 1 ved vingespidsen.
const lead = (a) => 0.3 - 0.55 * Math.pow(Math.max(0, a - 0.1) / 0.9, 1.6); // forkant
const trail = (a) => -0.3 + 0.05 * a + 0.12 * Math.sin(Math.PI * a); // bagkant
const thickness = (u, a) => 0.075 * Math.pow(1 - a, 1.3) * Math.pow(Math.sin(Math.PI * u), 0.8) + 0.004;

const TOP = [0.1, 0.12, 0.15];
const PATCH = [0.5, 0.53, 0.56]; // de lyse "skulder"-pletter på ryggen, bløde i kanten
const BELLY = [0.86, 0.87, 0.86];

function point(i, j, side) {
  const w = -1 + (2 * j) / SPAN;
  const a = Math.abs(w);
  const u = i / CHORD;
  const x = Scalar.Lerp(lead(a), trail(a), u);
  const th = thickness(u, a);
  const droop = -0.05 * a * a; // vingespidserne hænger en anelse
  return [x, droop + (side > 0 ? th : -th * 0.55), w * TIP];
}

function mantaColor(i, j, side) {
  if (side < 0) return BELLY;
  const u = (i + 0.5) / CHORD;
  const a = Math.abs(-1 + (2 * (j + 0.5)) / SPAN);
  const patch = Math.exp(-(((u - 0.4) / 0.16) ** 2) - (((a - 0.3) / 0.13) ** 2));
  return lerpColor(lerpColor(TOP, [0.16, 0.19, 0.23], a), PATCH, patch);
}

function buildMantaMesh(scene) {
  const positions = [];
  const colors = [];
  const tri = (a, b, c, rgb) => {
    positions.push(...a, ...b, ...c);
    for (let k = 0; k < 3; k++) colors.push(rgb[0], rgb[1], rgb[2], 1);
  };
  for (const side of [1, -1]) {
    for (let i = 0; i < CHORD; i++) {
      for (let j = 0; j < SPAN; j++) {
        const rgb = mantaColor(i, j, side);
        tri(point(i, j, side), point(i + 1, j, side), point(i + 1, j + 1, side), rgb);
        tri(point(i, j, side), point(i + 1, j + 1, side), point(i, j + 1, side), rgb);
      }
    }
  }
  // Kanten rundt om, så over- og underside hænger sammen
  const edge = (a, b) => {
    tri(a(1), a(-1), b(-1), TOP);
    tri(a(1), b(-1), b(1), TOP);
  };
  for (let j = 0; j < SPAN; j++) {
    edge((s) => point(0, j, s), (s) => point(0, j + 1, s));
    edge((s) => point(CHORD, j, s), (s) => point(CHORD, j + 1, s));
  }
  return flatMesh(scene, "manta", positions, colors);
}

export function createManta(scene) {
  const root = new TransformNode("rareManta", scene);
  const body = buildMantaMesh(scene);
  body.parent = root;

  // Hovedfinnerne foran munden og den tynde hale
  const dark = material(scene, "mantaDark", new Color3(0.1, 0.12, 0.15));
  for (const side of [-1, 1]) {
    const horn = MeshBuilder.CreateCylinder("mantaHorn", { height: 0.16, diameterTop: 0.01, diameterBottom: 0.06, tessellation: 5 }, scene);
    horn.material = dark;
    horn.parent = root;
    horn.rotation.z = -Math.PI / 2 - 0.3;
    horn.position.set(0.37, -0.02, side * 0.14);
  }
  const tail = MeshBuilder.CreateCylinder("mantaTail", { height: 0.5, diameterTop: 0.004, diameterBottom: 0.025, tessellation: 5 }, scene);
  tail.material = dark;
  tail.parent = root;
  tail.rotation.z = Math.PI / 2;
  tail.position.x = -0.5;

  root.scaling.setAll(4.2);
  root.setEnabled(false);

  const SPEED = 2.2;
  const LOOP_TIME = 8;
  const LOOP_RADIUS = 3;
  const velocity = new Vector3();
  const threat = { position: root.position, radius: 4, velocity };
  let t = 0;
  let dir = 1;
  let baseY = 0;
  let loop = null; // { time, center }
  let looped = false;
  let flap = 0;

  return {
    roots: [root],
    ready: true,
    done: false,
    start() {
      t = 0;
      this.done = false;
      dir = Math.random() < 0.5 ? 1 : -1;
      baseY = Scalar.RandomRange(2.5, 5.5);
      root.position.set(-dir * 38, baseY, Scalar.RandomRange(7, 12));
      root.rotation.set(0, dir > 0 ? 0 : Math.PI, 0);
      loop = null;
      looped = false;
      root.setEnabled(true);
      aquarium.threats.push(threat);
    },
    update(dt) {
      t += dt;
      const p = root.position;
      if (loop) {
        // Kolbøtte: en lodret cirkel hvor snuden går op, over og ned igen
        loop.time += dt;
        const a = Math.min(1, loop.time / LOOP_TIME) * Math.PI * 2;
        p.x = loop.center.x + dir * LOOP_RADIUS * Math.sin(a);
        p.y = loop.center.y + LOOP_RADIUS * (1 - Math.cos(a));
        root.rotation.z = a;
        root.rotation.x = 0;
        if (loop.time >= LOOP_TIME) {
          loop = null;
          looped = true;
          root.rotation.z = 0;
        }
        velocity.set(dir * SPEED * Math.cos(a), SPEED * Math.sin(a), 0);
      } else {
        velocity.set(dir * SPEED, Math.sin(t * 0.3) * 0.3, 0);
        p.addInPlace(velocity.scale(dt));
        root.rotation.z = Math.asin(velocity.y / SPEED) * 0.8;
        root.rotation.x = Math.sin(t * 0.4) * 0.12; // hælder blødt fra side til side
        if (!looped && Math.abs(p.x) < 3) loop = { time: 0, center: p.clone() };
      }

      // Vingeslag: en bølge der løber ud mod spidserne; hurtigere og kraftigere i kolbøtten
      flap += dt * (loop ? 1.9 : 1.3);
      const amp = loop ? 0.26 : 0.2;
      body.deform((x, y, z) => {
        const a = Math.abs(z) / TIP;
        return amp * Math.sin(flap - a * 1.4 - x * 1.5) * Math.pow(a, 1.5);
      });
      this.done = p.x * dir > 40;
    },
    stop() {
      root.setEnabled(false);
      const i = aquarium.threats.indexOf(threat);
      if (i >= 0) aquarium.threats.splice(i, 1);
    },
  };
}
