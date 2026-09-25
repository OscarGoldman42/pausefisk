import { Color3, MeshBuilder, Scalar, TransformNode, Vector3 } from "@babylonjs/core";
import { aquarium } from "../aquarium.js";
import { bubbleSystem, material } from "./common.js";
import { flatMesh } from "./creature.js";

// En havskildpadde glider roligt ind, svømmer op mod overfladen for at trække vejret
// og glider ned igen og videre ud af billedet. Forluffer slår som vinger; bagluffer styrer.
// Snuden peger mod +X.

// Skjoldet: en fladtrykt, facetteret kuppel hvor hver plade har sin egen brune nuance
function buildShell(scene) {
  const positions = [];
  const colors = [];
  const RINGS = 5;
  const SEGS = 10;
  const pt = (k, j) => {
    const lat = (k / RINGS) * Math.PI * 0.5; // 0 ved kanten, π/2 på toppen
    const a = (j / SEGS) * Math.PI * 2;
    return [Math.cos(lat) * Math.cos(a) * 0.55, Math.sin(lat) * 0.2, Math.cos(lat) * Math.sin(a) * 0.42];
  };
  const tri = (a, b, c, rgb) => {
    positions.push(...a, ...b, ...c);
    for (let i = 0; i < 3; i++) colors.push(rgb[0], rgb[1], rgb[2], 1);
  };
  for (let k = 0; k < RINGS; k++) {
    for (let j = 0; j < SEGS; j++) {
      const shade = 0.8 + ((k * 7 + j * 3) % 5) * 0.07; // plademønster
      const rgb = [0.38 * shade, 0.29 * shade, 0.16 * shade];
      tri(pt(k, j), pt(k + 1, j), pt(k + 1, j + 1), rgb);
      tri(pt(k, j), pt(k + 1, j + 1), pt(k, j + 1), rgb);
    }
  }
  // Bugskjold: flad og lys
  for (let j = 0; j < SEGS; j++) tri(pt(0, j), [0, -0.05, 0], pt(0, j + 1), [0.78, 0.7, 0.45]);
  return flatMesh(scene, "turtleShell", positions, colors);
}

export function createTurtle(scene, { bubbleTexture }) {
  const root = new TransformNode("rareTurtle", scene);
  const body = new TransformNode("turtleBody", scene);
  body.parent = root;
  buildShell(scene).parent = body;

  const skin = material(scene, "turtleSkin", new Color3(0.36, 0.38, 0.26), { caustics: 0.25, rim: 0.15 });
  const eyeMat = material(scene, "turtleEye", new Color3(0.03, 0.03, 0.03), { specular: 0.8 });
  const head = MeshBuilder.CreateSphere("turtleHead", { diameter: 1, segments: 4 }, scene);
  head.material = skin;
  head.parent = body;
  head.scaling.set(0.3, 0.19, 0.2);
  head.position.set(0.6, 0.03, 0);
  head.convertToFlatShadedMesh();
  const neck = MeshBuilder.CreateCylinder("turtleNeck", { height: 0.2, diameterTop: 0.15, diameterBottom: 0.2, tessellation: 7 }, scene);
  neck.material = skin;
  neck.parent = body;
  neck.rotation.z = -Math.PI / 2;
  neck.position.set(0.48, 0.02, 0);
  for (const side of [-1, 1]) {
    const eye = MeshBuilder.CreateSphere("turtleEyeball", { diameter: 0.045, segments: 4 }, scene);
    eye.material = eyeMat;
    eye.parent = body;
    eye.position.set(0.66, 0.06, side * 0.085);
  }

  // Luffe: en flad, tilspidset plade fra en hængsel-node
  const flipper = (name, length, width, side) => {
    const hinge = new TransformNode(name, scene);
    hinge.parent = body;
    const f = MeshBuilder.CreateSphere(`${name}Mesh`, { diameter: 1, segments: 3 }, scene);
    f.material = skin;
    f.parent = hinge;
    f.scaling.set(width, 0.04, length);
    f.position.z = (side * length) / 2;
    f.convertToFlatShadedMesh();
    return hinge;
  };
  const front = [-1, 1].map((side) => {
    const h = flipper("turtleFront", 0.75, 0.2, side);
    h.position.set(0.3, -0.03, side * 0.3);
    h.rotation.y = side * 0.5; // strøget bagud som vinger
    return { hinge: h, side };
  });
  const rear = [-1, 1].map((side) => {
    const h = flipper("turtleRear", 0.24, 0.14, side);
    h.position.set(-0.42, -0.03, side * 0.2);
    h.rotation.y = -side * 0.7;
    return { hinge: h, side };
  });

  root.scaling.setAll(3);
  root.setEnabled(false);

  // Et par bobler når den har været oppe og trække vejret
  const bubbles = bubbleSystem(scene, "turtleBubbles", bubbleTexture, 100);
  bubbles.emitter = head;
  bubbles.minSize = 0.05;
  bubbles.maxSize = 0.16;
  bubbles.minEmitPower = 0.2;
  bubbles.maxEmitPower = 0.5;
  bubbles.start();

  const SPEED = 1.7;
  const velocity = new Vector3();
  const threat = { position: root.position, radius: 2.5, velocity };
  let t = 0;
  let dir = 1;
  let startY = 0;
  let breathed = false;
  let flap = 0;
  const TOP_Y = 11.3;

  // Banen: lav i siderne, oppe ved overfladen midt i billedet
  const pathY = (x) => startY + (TOP_Y - startY) * Math.exp(-((x / 11) ** 2));

  return {
    roots: [root],
    ready: true,
    done: false,
    start() {
      t = 0;
      this.done = false;
      breathed = false;
      dir = Math.random() < 0.5 ? 1 : -1;
      startY = Scalar.RandomRange(0, 3);
      root.position.set(-dir * 36, pathY(-dir * 36), Scalar.RandomRange(10, 13));
      root.rotation.y = dir > 0 ? 0 : Math.PI;
      root.setEnabled(true);
      aquarium.threats.push(threat);
    },
    update(dt) {
      t += dt;
      const p = root.position;
      // Farten falder helt op ved overfladen, hvor den trækker vejret
      const nearTop = Math.exp(-((p.x / 3) ** 2));
      const speed = SPEED * (1 - 0.75 * nearTop);
      const x = p.x + dir * speed * dt;
      const y = pathY(x);
      velocity.set(dir * speed, (y - p.y) / dt, 0);
      p.set(x, y, p.z);
      root.rotation.z = Math.atan2(velocity.y, speed) * 0.9; // snuden følger banen op og ned
      head.rotation.z = nearTop * 0.4; // strækker hovedet op for at få luft
      if (!breathed && dir * p.x > 1) {
        breathed = true;
        bubbles.manualEmitCount = 25;
      }

      // Forlufferne slår som vinger; slaget er hurtigt ned og roligt op
      flap += dt * (1.8 - nearTop);
      const beat = Math.sin(flap);
      for (const f of front) {
        f.hinge.rotation.x = -f.side * (0.15 + 0.55 * beat);
        f.hinge.rotation.z = 0.25 * Math.cos(flap);
      }
      for (const f of rear) f.hinge.rotation.x = f.side * 0.15 * Math.sin(flap * 0.7);
      body.rotation.x = beat * 0.04;
      body.position.y = -beat * 0.03;
      this.done = p.x * dir > 38;
    },
    stop() {
      root.setEnabled(false);
      const i = aquarium.threats.indexOf(threat);
      if (i >= 0) aquarium.threats.splice(i, 1);
    },
  };
}
