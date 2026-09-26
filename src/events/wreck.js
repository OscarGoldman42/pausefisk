import { Color3, Color4, LoadAssetContainerAsync, ParticleSystem, Scalar, TransformNode, Vector3 } from "@babylonjs/core";
import { FLOOR_Y, aquarium } from "../aquarium.js";
import { CausticsPlugin } from "../caustics.js";
import { bubbleSystem, createPuffTexture } from "./common.js";

// ---------- Skibsvrag ----------
// En gammel båd synker fra overfladen med en boblestribe efter sig, lægger sig skævt på bunden
// og hvirvler sand op. Til sidst synker den langsomt ned i sandet og toner ud.
export function createWreck(scene, { bubbleTexture }) {
  const root = new TransformNode("rareWreck", scene);
  const tilt = new TransformNode("wreckTilt", scene);
  tilt.parent = root;
  const LENGTH = 9;
  let meshes = [];
  let halfHeight = 1;

  const event = { roots: [root], ready: false, done: false };
  LoadAssetContainerAsync("assets/FBX/Boat.fbx", scene).then((container) => {
    for (const mat of container.materials) {
      // Mørkere og grønligt tilgroet i forhold til den friske båd
      const c = mat.diffuseColor.toGammaSpace();
      mat.diffuseColor = Color3.Lerp(c, new Color3(0.3, 0.38, 0.28), 0.35).scale(0.95);
      mat.ambientColor = mat.diffuseColor.scale(0.5);
      mat.specularColor = new Color3(0.05, 0.05, 0.05);
      new CausticsPlugin(mat, { caustics: 0.45, rim: 0.15 });
    }
    const entries = container.instantiateModelsToScene((n) => `wreck_${n}`);
    const model = new TransformNode("wreckModel", scene);
    for (const node of entries.rootNodes) node.parent = model;
    const { min, max } = model.getHierarchyBoundingVectors(true);
    const size = max.subtract(min);
    const center = min.add(max).scale(0.5);
    for (const node of entries.rootNodes) node.position.subtractInPlace(center);
    const longest = Math.max(size.x, size.z);
    model.scaling.setAll(LENGTH / longest);
    if (size.x > size.z) model.rotation.y = Math.PI / 2; // båden ligger langs Z inde i tilt-noden
    model.parent = tilt;
    halfHeight = (size.y * LENGTH) / longest / 2;
    meshes = model.getChildMeshes();
    root.setEnabled(false);
    event.ready = true;
  });

  // Luft der slipper ud af vraget, mens det synker
  const trail = bubbleSystem(scene, "wreckBubbles", bubbleTexture, 600);
  trail.emitter = root.position;
  trail.createBoxEmitter(new Vector3(-0.2, 1, -0.2), new Vector3(0.2, 1, 0.2), new Vector3(-1.5, 0, -2), new Vector3(1.5, 0.5, 2));
  trail.minSize = 0.08;
  trail.maxSize = 0.35;
  trail.minEmitPower = 0.5;
  trail.maxEmitPower = 1.5;
  trail.start();

  // Sandsky når den rammer bunden
  const sand = new ParticleSystem("wreckSand", 400, scene);
  sand.particleTexture = createPuffTexture(scene);
  sand.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  sand.color1 = new Color4(0.75, 0.7, 0.55, 0.5);
  sand.color2 = new Color4(0.6, 0.58, 0.45, 0.35);
  sand.colorDead = new Color4(0.6, 0.58, 0.45, 0);
  sand.emitter = root.position;
  sand.createCylinderEmitter(3.5, 0.2, 0.5, 0);
  sand.minSize = 0.6;
  sand.maxSize = 1.6;
  sand.minLifeTime = 3;
  sand.maxLifeTime = 5;
  sand.minEmitPower = 0.6;
  sand.maxEmitPower = 1.6;
  sand.gravity = new Vector3(0, -0.25, 0);
  sand.emitRate = 0;
  sand.manualEmitCount = 0;
  sand.start();

  const START_Y = 16;
  const threat = { position: root.position, radius: 4 };
  let t = 0;
  let restY = 0;
  let landed = false;
  let roll = 0;
  let spin = 0;

  return Object.assign(event, {
    start() {
      t = 0;
      this.done = false;
      landed = false;
      const side = Math.random() < 0.5 ? -1 : 1;
      root.position.set(side * Scalar.RandomRange(3, 7), START_Y, Scalar.RandomRange(21, 25));
      root.rotation.set(0, Scalar.RandomRange(-0.5, 0.5) + Math.PI / 2 + side * 0.3, 0);
      roll = Scalar.RandomRange(0.25, 0.4) * (Math.random() < 0.5 ? -1 : 1);
      spin = Scalar.RandomRange(-0.06, 0.06);
      restY = FLOOR_Y + halfHeight * 0.6; // lidt begravet i sandet
      for (const m of meshes) m.visibility = 1;
      root.setEnabled(true);
      trail.emitRate = 45;
      aquarium.threats.push(threat);
    },
    update(dt) {
      t += dt;
      const p = root.position;
      if (!landed) {
        // Synker med stævnen lidt nedad og vugger fra side til side
        p.y -= dt * Math.min(1.1, 0.3 + t * 0.15);
        root.rotation.y += spin * dt;
        tilt.rotation.z = Scalar.Lerp(tilt.rotation.z, roll * 0.5 + Math.sin(t * 0.9) * 0.12, dt);
        tilt.rotation.x = Scalar.Lerp(tilt.rotation.x, 0.25 + Math.sin(t * 0.6) * 0.08, dt);
        if (p.y <= restY) {
          p.y = restY;
          landed = true;
          t = 0;
          sand.manualEmitCount = 260;
          trail.emitRate = 0;
          trail.manualEmitCount = 60;
        }
        return;
      }
      // Lægger sig tilrette på siden
      tilt.rotation.z = Scalar.Lerp(tilt.rotation.z, roll, Math.min(1, dt * 1.5));
      tilt.rotation.x = Scalar.Lerp(tilt.rotation.x, 0.08, Math.min(1, dt * 1.5));
      if (t > 45) {
        const f = Math.max(0, 1 - (t - 45) / 8);
        p.y = restY - (1 - f) * halfHeight;
        for (const m of meshes) m.visibility = f;
        this.done = f === 0;
      }
    },
    stop() {
      root.setEnabled(false);
      trail.emitRate = 0;
      aquarium.threats.splice(aquarium.threats.indexOf(threat), 1);
    },
  });
}

