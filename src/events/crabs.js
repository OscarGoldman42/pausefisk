import { Color3, Color4, MeshBuilder, ParticleSystem, Scalar, TransformNode, Vector3 } from "@babylonjs/core";
import { FLOOR_Y } from "../aquarium.js";
import { createPuffTexture, material } from "./common.js";

// Tre krabber går sidelæns ind over sandet i forgrunden. De stopper op, knipser med kløerne
// og kigger rundt med øjnene, og til sidst graver de sig ned i sandet.
// Modellen vender ansigtet mod kameraet (-Z) og går langs X.

const SCALE = 1.3;
const LEG_HEIGHT = 0.22; // hvor højt kroppen står over sandet (før skalering), så benspidserne rammer sandet

function buildCrab(scene, name, mats) {
  const root = new TransformNode(name, scene);
  const body = new TransformNode(`${name}Body`, scene);
  body.parent = root;
  const add = (mesh, mat, parent) => {
    mesh.material = mat;
    mesh.parent = parent;
    return mesh;
  };
  // Cylinder langs lokal X, der starter i noden
  const segmentX = (len, diameter, mat, parent, side) => {
    const m = add(MeshBuilder.CreateCylinder(`${name}Seg`, { height: len, diameterTop: diameter * 0.7, diameterBottom: diameter, tessellation: 6 }, scene), mat, parent);
    m.rotation.z = -side * Math.PI / 2;
    m.position.x = (side * len) / 2;
    return m;
  };

  const shell = add(MeshBuilder.CreateSphere(`${name}Shell`, { diameter: 1, segments: 3 }, scene), mats.shell, body);
  shell.scaling.set(1, 0.42, 0.74);
  shell.convertToFlatShadedMesh();

  // Øjne på stilke
  const eyes = [-1, 1].map((side) => {
    const stalk = new TransformNode(`${name}EyeStalk`, scene);
    stalk.parent = body;
    stalk.position.set(side * 0.1, 0.12, -0.3);
    const s = add(MeshBuilder.CreateCylinder(`${name}Stalk`, { height: 0.2, diameter: 0.05, tessellation: 5 }, scene), mats.shell, stalk);
    s.position.y = 0.1;
    const eye = add(MeshBuilder.CreateSphere(`${name}Eye`, { diameter: 0.09, segments: 4 }, scene), mats.eye, stalk);
    eye.position.y = 0.21;
    return stalk;
  });

  // Fire ben i hver side: hofte (drejer frem/tilbage) → lår (løftes) → knæ → underben ned mod sandet
  const legs = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const hip = new TransformNode(`${name}Hip`, scene);
      hip.parent = body;
      hip.position.set(side * 0.4, -0.02, -0.14 + i * 0.13);
      hip.rotation.y = side * (i - 1.5) * 0.35; // benene vifter ud
      const femur = new TransformNode(`${name}Femur`, scene);
      femur.parent = hip;
      segmentX(0.36, 0.08, mats.shell, femur, side);
      const knee = new TransformNode(`${name}Knee`, scene);
      knee.parent = femur;
      knee.position.x = side * 0.36;
      knee.rotation.z = -side * 1.5;
      segmentX(0.44, 0.06, mats.leg, knee, side);
      legs.push({ hip, femur, side, phase: i * Math.PI * 0.5 + (side > 0 ? Math.PI : 0), baseYaw: hip.rotation.y });
    }
  }

  // Kløer: overarm frem fra kroppen → håndled der vender indad → en kraftig håndflade med en fast
  // og en bevægelig finger. Fingrene har skallens farve og kun mørke spidser; kløerne holdes løftet foran ansigtet.
  // Kegle der peger mod -Z fra sin node, med en mørk spids for enden
  const finger = (parent, len, diameter) => {
    const f = add(MeshBuilder.CreateCylinder(`${name}Finger`, { height: len, diameterTop: diameter * 0.45, diameterBottom: diameter, tessellation: 6 }, scene), mats.shell, parent);
    f.rotation.x = -Math.PI / 2;
    f.position.z = -len / 2;
    const tip = add(MeshBuilder.CreateCylinder(`${name}FingerTip`, { height: len * 0.35, diameterTop: 0.005, diameterBottom: diameter * 0.45, tessellation: 6 }, scene), mats.tip, parent);
    tip.rotation.x = -Math.PI / 2;
    tip.position.z = -len - len * 0.17;
  };
  const claws = [-1, 1].map((side) => {
    const shoulder = new TransformNode(`${name}Shoulder`, scene);
    shoulder.parent = body;
    shoulder.position.set(side * 0.3, 0.02, -0.25);
    shoulder.rotation.y = -side * 0.55; // overarmen peger skråt ud til siden
    const arm = add(MeshBuilder.CreateCylinder(`${name}Arm`, { height: 0.26, diameterTop: 0.1, diameterBottom: 0.12, tessellation: 6 }, scene), mats.shell, shoulder);
    arm.rotation.x = -Math.PI / 2;
    arm.position.z = -0.13;
    const wrist = new TransformNode(`${name}Wrist`, scene);
    wrist.parent = shoulder;
    wrist.position.z = -0.26;
    wrist.rotation.set(0.25, side * 1.25, 0); // drejet ind foran ansigtet og vippet lidt op
    const joint = add(MeshBuilder.CreateSphere(`${name}Joint`, { diameter: 0.14, segments: 3 }, scene), mats.shell, wrist);
    joint.convertToFlatShadedMesh();
    const palm = add(MeshBuilder.CreateSphere(`${name}Palm`, { diameter: 1, segments: 4 }, scene), mats.shell, wrist);
    palm.scaling.set(0.2, 0.18, 0.34);
    palm.position.z = -0.17;
    palm.convertToFlatShadedMesh();
    const fixed = new TransformNode(`${name}Fixed`, scene);
    fixed.parent = wrist;
    fixed.position.set(0, -0.035, -0.31);
    finger(fixed, 0.16, 0.085);
    const moving = new TransformNode(`${name}Moving`, scene);
    moving.parent = wrist;
    moving.position.set(0, 0.05, -0.29);
    finger(moving, 0.15, 0.075);
    return { shoulder, moving, side };
  });

  root.scaling.setAll(SCALE);
  root.setEnabled(false);
  return { root, body, eyes, legs, claws };
}

export function createCrabs(scene) {
  const mats = {
    shell: material(scene, "crabShell", new Color3(0.86, 0.34, 0.16), { caustics: 0.4, rim: 0.2 }),
    leg: material(scene, "crabLeg", new Color3(0.78, 0.3, 0.14), { caustics: 0.4, rim: 0.2 }),
    tip: material(scene, "crabTip", new Color3(0.25, 0.1, 0.06)),
    eye: material(scene, "crabEye", new Color3(0.03, 0.03, 0.03), { specular: 0.8 }),
  };
  const crabs = Array.from({ length: 3 }, (_, i) => buildCrab(scene, `rareCrab${i}`, mats));

  const sand = new ParticleSystem("crabSand", 300, scene);
  sand.particleTexture = createPuffTexture(scene);
  sand.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  sand.color1 = new Color4(0.78, 0.72, 0.56, 0.5);
  sand.color2 = new Color4(0.65, 0.6, 0.46, 0.35);
  sand.colorDead = new Color4(0.65, 0.6, 0.46, 0);
  sand.emitter = new Vector3();
  sand.createCylinderEmitter(0.5, 0.1, 0.3, 0);
  sand.minSize = 0.3;
  sand.maxSize = 0.8;
  sand.minLifeTime = 1.5;
  sand.maxLifeTime = 3;
  sand.minEmitPower = 0.3;
  sand.maxEmitPower = 0.9;
  sand.gravity = new Vector3(0, -0.3, 0);
  sand.emitRate = 0;
  sand.start();

  const restY = FLOOR_Y + LEG_HEIGHT * SCALE;
  let t = 0;

  return {
    roots: crabs.map((c) => c.root),
    ready: true,
    done: false,
    start() {
      t = 0;
      this.done = false;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const targets = [-7, 0, 7].map((x) => x + Scalar.RandomRange(-2.5, 2.5)).sort((a, b) => (a - b) * dir);
      crabs.forEach((c, i) => {
        c.root.position.set(-dir * (19 + i * 2.5), restY, Scalar.RandomRange(2, 6));
        c.root.rotation.y = Scalar.RandomRange(-0.25, 0.25);
        c.dir = dir;
        c.target = targets[i];
        c.state = "walk";
        c.timer = Scalar.RandomRange(2.5, 4);
        c.walk = Math.random() * 6;
        c.snap = 0;
        c.sink = 0;
        c.root.setEnabled(true);
      });
    },
    update(dt) {
      t += dt;
      let allGone = true;
      for (const c of crabs) {
        if (c.state === "gone") continue;
        allGone = false;
        const p = c.root.position;
        c.timer -= dt;
        let walking = false;

        if (c.state === "walk") {
          walking = true;
          p.x += c.dir * 1.7 * dt;
          if ((c.target - p.x) * c.dir <= 0 || t > 40) {
            c.state = "dig";
            c.timer = 3;
          } else if (c.timer <= 0) {
            c.state = "pause";
            c.timer = Scalar.RandomRange(1.5, 2.8);
          }
        } else if (c.state === "pause") {
          c.snap += dt;
          if (c.timer <= 0) {
            c.state = "walk";
            c.timer = Scalar.RandomRange(2.5, 4.5);
          }
        } else if (c.state === "dig") {
          // Graver sig ned: vrikker hurtigt med benene og synker, mens sandet hvirvler op
          c.sink = Math.min(1, c.sink + dt / 2.6);
          p.y = restY - c.sink * 0.75 * SCALE;
          if (Math.random() < dt * 8) {
            sand.emitter.copyFrom(p);
            sand.emitter.y = FLOOR_Y;
            sand.manualEmitCount = 6;
          }
          if (c.sink >= 1) {
            c.state = "gone";
            c.root.setEnabled(false);
          }
        }

        // Ganggang: benene løftes og svinger på skift; kroppen vugger lidt
        const digging = c.state === "dig";
        c.walk += dt * (digging ? 16 : walking ? 9 : 0);
        for (const leg of c.legs) {
          const phase = c.walk + leg.phase;
          const active = walking || digging ? 1 : 0;
          leg.femur.rotation.z = leg.side * (0.55 + active * Math.max(0, Math.sin(phase)) * 0.4);
          leg.hip.rotation.y = leg.baseYaw + active * Math.cos(phase) * 0.25;
        }
        c.body.position.y = walking ? Math.abs(Math.sin(c.walk)) * 0.03 : 0;
        c.body.rotation.z = walking ? Math.sin(c.walk * 0.5) * 0.05 : 0;

        // Kløerne knipser, når krabben står stille; øjnene kigger rundt
        const snapping = c.state === "pause";
        for (const claw of c.claws) {
          const s = snapping ? Math.max(0, Math.sin(c.snap * 7 + claw.side)) : 0;
          claw.moving.rotation.x = -0.15 + s * 0.6; // åbner opad og klapper i
          claw.shoulder.rotation.x = snapping ? 0.3 : 0.08; // løfter kløerne når den knipser
        }
        for (const [i, eye] of c.eyes.entries()) eye.rotation.z = Math.sin(t * 1.3 + i * 2 + c.target) * 0.25;
      }
      this.done = allGone;
    },
    stop() {
      for (const c of crabs) c.root.setEnabled(false);
    },
  };
}
