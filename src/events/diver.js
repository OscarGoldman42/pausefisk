import { Color3, Mesh, MeshBuilder, Scalar, TransformNode, Vector3 } from "@babylonjs/core";
import { aquarium } from "../aquarium.js";
import { bubbleSystem, material } from "./common.js";

// ---------- Dykker ----------
// Ligger vandret og svømmer med flagspark: lårene svinger fra hoften, knæene bøjer på vej op,
// og svømmefødderne følger efter med en lille forsinkelse, så de ser bløde ud.
// Modellen vender mod +X; hierarki: root (position/retning) → body (små vip) → dele.
export function createDiver(scene, { bubbleTexture }) {
  const suit = material(scene, "diverSuit", new Color3(0.14, 0.17, 0.22), { rim: 0.35 });
  const accent = material(scene, "diverAccent", new Color3(0.1, 0.62, 0.7));
  const tankMat = material(scene, "diverTank", new Color3(0.95, 0.72, 0.12), { specular: 0.4 });
  const finMat = material(scene, "diverFins", new Color3(0.98, 0.8, 0.15));
  finMat.backFaceCulling = false;
  const glass = material(scene, "diverMask", new Color3(0.1, 0.25, 0.3), { emissive: new Color3(0.12, 0.35, 0.42), specular: 0.9 });
  const black = material(scene, "diverRubber", new Color3(0.03, 0.03, 0.04));

  const root = new TransformNode("rareDiver", scene);
  const body = new TransformNode("diverBody", scene);
  body.parent = root;
  const add = (mesh, mat, parent = body) => {
    mesh.material = mat;
    mesh.parent = parent;
    return mesh;
  };
  // Kapsel langs X-aksen (CreateCapsule ligger langs Y)
  const capsuleX = (name, length, radius, mat, parent) => {
    const m = add(MeshBuilder.CreateCapsule(name, { height: length, radius, tessellation: 12, capSubdivisions: 4 }, scene), mat, parent);
    m.rotation.z = Math.PI / 2;
    return m;
  };

  // Krop: lidt fladere end bred, med en farvet stribe over brystet
  const torso = capsuleX("diverTorso", 1.3, 0.27, suit);
  torso.scaling.set(0.85, 1, 1.15);
  const stripe = capsuleX("diverStripe", 0.5, 0.275, accent);
  stripe.position.x = 0.2;
  stripe.scaling.set(0.87, 1, 1.17);

  // Hoved med hætte, maske og regulator
  const head = add(MeshBuilder.CreateSphere("diverHead", { diameter: 0.4, segments: 12 }, scene), suit);
  head.position.set(0.8, 0.06, 0);
  const mask = add(MeshBuilder.CreateBox("diverMask", { width: 0.1, height: 0.17, depth: 0.3 }, scene), glass);
  mask.position.set(0.97, 0.1, 0);
  mask.rotation.z = -0.25;
  const strap = add(MeshBuilder.CreateTorus("diverStrap", { diameter: 0.4, thickness: 0.035, tessellation: 20 }, scene), black);
  strap.position.set(0.8, 0.1, 0);
  strap.rotation.z = Math.PI / 2 - 0.25;
  const regulator = add(MeshBuilder.CreateCylinder("diverRegulator", { height: 0.12, diameter: 0.09, tessellation: 10 }, scene), black);
  regulator.position.set(0.97, -0.07, 0);
  regulator.rotation.z = Math.PI / 2;

  // Flaske på ryggen og slangen frem til munden
  const tank = capsuleX("diverTank", 0.95, 0.14, tankMat);
  tank.position.set(-0.05, 0.3, 0);
  const valve = add(MeshBuilder.CreateCylinder("diverValve", { height: 0.12, diameter: 0.07, tessellation: 8 }, scene), black);
  valve.position.set(0.47, 0.34, 0);
  valve.rotation.z = Math.PI / 2;
  const hosePath = [new Vector3(0.52, 0.34, 0), new Vector3(0.72, 0.36, 0.2), new Vector3(0.95, 0.1, 0.18), new Vector3(0.98, -0.06, 0.06)];
  add(MeshBuilder.CreateTube("diverHose", { path: hosePath, radius: 0.025, tessellation: 8 }, scene), black);

  // Armene holdes ind langs kroppen, som dykkere gør for at spare luft
  for (const side of [-1, 1]) {
    const path = [new Vector3(0.5, 0.02, 0.28 * side), new Vector3(0.18, -0.2, 0.34 * side), new Vector3(-0.15, -0.22, 0.26 * side)];
    add(MeshBuilder.CreateTube("diverArm", { path, radius: 0.075, tessellation: 10, cap: Mesh.CAP_ALL }, scene), suit);
    const hand = add(MeshBuilder.CreateSphere("diverHand", { diameter: 0.15, segments: 8 }, scene), black);
    hand.position.set(-0.18, -0.22, 0.25 * side);
  }

  // Ben: hofte → knæ → ankel med svømmefod. Hvert led er en TransformNode der kan drejes om Z.
  const legs = [-1, 1].map((side) => {
    const hip = new TransformNode("diverHip", scene);
    hip.parent = body;
    hip.position.set(-0.62, -0.02, 0.13 * side);
    const thigh = capsuleX("diverThigh", 0.62, 0.11, suit, hip);
    thigh.position.x = -0.26;
    const knee = new TransformNode("diverKnee", scene);
    knee.parent = hip;
    knee.position.x = -0.55;
    const shin = capsuleX("diverShin", 0.56, 0.09, suit, knee);
    shin.position.x = -0.25;
    const ankle = new TransformNode("diverAnkle", scene);
    ankle.parent = knee;
    ankle.position.x = -0.5;
    const boot = capsuleX("diverBoot", 0.28, 0.08, black, ankle);
    boot.position.x = -0.08;
    // Svømmefod: en tilspidset, let buet plade
    const blade = (z0, z1) => [0, 0.25, 0.5, 0.78].map((x, i) => new Vector3(-0.1 - x, 0.015 * i * i, Scalar.Lerp(z0, z1, i / 3)));
    const fin = add(MeshBuilder.CreateRibbon("diverFin", { pathArray: [blade(-0.09, -0.2), blade(0.09, 0.2)], sideOrientation: Mesh.DOUBLESIDE }, scene), finMat, ankle);
    fin.position.y = -0.02;
    return { hip, knee, ankle, phase: side < 0 ? 0 : Math.PI };
  });

  root.scaling.setAll(1.6);
  root.setEnabled(false);

  // Udånding: en klump bobler fra regulatoren med få sekunders mellemrum
  const bubbles = bubbleSystem(scene, "diverBubbles", bubbleTexture, 300);
  bubbles.emitter = regulator;
  bubbles.createSphereEmitter(0.08);
  bubbles.minSize = 0.05;
  bubbles.maxSize = 0.2;
  bubbles.minEmitPower = 0.3;
  bubbles.maxEmitPower = 0.8;
  bubbles.start();

  const SPEED = 1.5;
  const KICK = Math.PI * 2 * 0.75; // flagspark i sekundet
  const velocity = new Vector3();
  const threat = { position: root.position, radius: 4.5, velocity };
  let t = 0;
  let dir = 1;
  let breath = 0;
  let baseY = 0;

  return {
    roots: [root],
    ready: true,
    done: false,
    start() {
      t = 0;
      this.done = false;
      dir = Math.random() < 0.5 ? 1 : -1;
      baseY = Scalar.RandomRange(2, 5);
      root.position.set(-dir * 38, baseY, Scalar.RandomRange(13, 17));
      root.rotation.y = dir > 0 ? 0 : Math.PI;
      velocity.set(dir * SPEED, 0, 0);
      breath = 1;
      root.setEnabled(true);
      aquarium.threats.push(threat);
    },
    update(dt) {
      t += dt;
      // Glider frem i små ryk for hvert spark og bølger roligt op og ned
      const surge = 1 + 0.25 * Math.sin(t * KICK * 2);
      root.position.x += velocity.x * surge * dt;
      root.position.y = baseY + Math.sin(t * 0.3) * 0.8;
      body.rotation.z = -0.06 + Math.cos(t * 0.3) * 0.08; // næsen følger op/ned-bølgen
      body.rotation.x = Math.sin(t * KICK) * 0.04; // let rul fra side til side

      for (const leg of legs) {
        const p = t * KICK + leg.phase;
        leg.hip.rotation.z = 0.28 * Math.sin(p);
        leg.knee.rotation.z = -(0.12 + 0.45 * (0.5 + 0.5 * Math.sin(p - 1.1))); // knæet bøjer, så hælen går op
        leg.ankle.rotation.z = 0.12 + 0.4 * Math.sin(p - 2); // finnen slæber efter
      }

      breath -= dt;
      if (breath <= 0) {
        bubbles.manualEmitCount = Math.round(Scalar.RandomRange(12, 22));
        breath = Scalar.RandomRange(3, 4.5);
      }
      this.done = root.position.x * dir > 40;
    },
    stop() {
      root.setEnabled(false);
      aquarium.threats.splice(aquarium.threats.indexOf(threat), 1);
    },
  };
}

