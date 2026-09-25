import { Color3, Color4, MeshBuilder, ParticleSystem, Scalar, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";
import { FLOOR_Y, aquarium } from "../aquarium.js";
import { CausticsPlugin } from "../caustics.js";
import { createPuffTexture, material } from "./common.js";

// En blæksprutte der ligger camoufleret som en sten på bunden. Den skifter langsomt til klare farver,
// kravler et stykke hen over sandet med bølgende arme, bliver forskrækket, blinker bleg,
// sprøjter en sky af blæk ud og skyder væk med armene samlet bag sig.

const ARMS = 8;
const ARM_POINTS = 12;
const ARM_LENGTH = 1.7;

const CAMO = new Color3(0.36, 0.4, 0.4);
const VIVID = new Color3(0.86, 0.33, 0.2);
const DARK = new Color3(0.55, 0.16, 0.12);
const PALE = new Color3(0.92, 0.86, 0.8);

export function createOctopus(scene) {
  const root = new TransformNode("rareOctopus", scene);
  const skin = new StandardMaterial("octopusSkin", scene);
  skin.diffuseColor = CAMO.clone();
  skin.ambientColor = new Color3(0.5, 0.5, 0.5);
  skin.specularColor = new Color3(0.25, 0.25, 0.25);
  skin.specularPower = 24;
  new CausticsPlugin(skin, { caustics: 0.4, rim: 0.25 });

  // Hoved/kappe: en fladtrykt, lidt bagoverhældende kugle med øjne på siden
  const mantleNode = new TransformNode("octopusMantleNode", scene);
  mantleNode.parent = root;
  mantleNode.position.y = 0.45;
  const mantle = MeshBuilder.CreateSphere("octopusMantle", { diameter: 1, segments: 8 }, scene);
  mantle.material = skin;
  mantle.parent = mantleNode;
  mantle.scaling.set(0.7, 0.85, 0.62);
  mantle.position.set(-0.12, 0.2, 0);
  mantle.rotation.z = 0.35;
  const eyeMat = material(scene, "octopusEye", new Color3(0.95, 0.85, 0.4), { emissive: new Color3(0.2, 0.18, 0.05) });
  const pupilMat = material(scene, "octopusPupil", new Color3(0.02, 0.02, 0.02));
  for (const side of [-1, 1]) {
    const eye = MeshBuilder.CreateSphere("octopusEyeball", { diameter: 0.17, segments: 6 }, scene);
    eye.material = eyeMat;
    eye.parent = mantleNode;
    eye.position.set(0.14, 0.02, side * 0.24);
    const pupil = MeshBuilder.CreateBox("octopusPupil", { width: 0.1, height: 0.03, depth: 0.03 }, scene);
    pupil.material = pupilMat;
    pupil.parent = eye;
    pupil.position.set(0.02, 0, side * 0.07);
  }

  // Arme: rør der genberegnes hver frame
  const arms = Array.from({ length: ARMS }, (_, i) => {
    const angle = (i / ARMS) * Math.PI * 2 + 0.2;
    const path = Array.from({ length: ARM_POINTS }, () => new Vector3());
    const radius = (k) => 0.11 * (1 - k / ARM_POINTS) + 0.012;
    const mesh = MeshBuilder.CreateTube("octopusArm", { path: path.map((_, k) => new Vector3(k * 0.1, 0, 0)), radiusFunction: radius, tessellation: 7, updatable: true }, scene);
    mesh.material = skin;
    mesh.parent = root;
    return { mesh, path, radius, angle, seed: Math.random() * 10 };
  });

  // Blækskyen
  const ink = new ParticleSystem("octopusInk", 250, scene);
  ink.particleTexture = createPuffTexture(scene);
  ink.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  ink.color1 = new Color4(0.04, 0.02, 0.07, 0.85);
  ink.color2 = new Color4(0.08, 0.04, 0.1, 0.7);
  ink.colorDead = new Color4(0.06, 0.04, 0.08, 0);
  ink.addSizeGradient(0, 0.4);
  ink.addSizeGradient(1, 2.6);
  ink.minLifeTime = 4;
  ink.maxLifeTime = 6.5;
  ink.minEmitPower = 0.4;
  ink.maxEmitPower = 1.8;
  ink.createSphereEmitter(0.3);
  ink.gravity = new Vector3(0, 0.08, 0);
  ink.emitter = new Vector3();
  ink.emitRate = 0;
  ink.start();

  const SCALE = 1.4;
  root.scaling.setAll(SCALE);
  root.setEnabled(false);
  const parts = root.getChildMeshes();

  const jet = new Vector3(); // retningen den skyder væk i, i modellens egne koordinater (armene trækkes efter)
  const worldJet = new Vector3();
  const threat = { position: root.position, radius: 2.5 };
  let t = 0;
  let dir = 1;
  let inked = false;

  function updateArms(mode) {
    for (const arm of arms) {
      const out = new Vector3(Math.cos(arm.angle), 0, Math.sin(arm.angle));
      const seg = ARM_LENGTH / (ARM_POINTS - 1);
      for (let k = 0; k < ARM_POINTS; k++) {
        const f = k / (ARM_POINTS - 1);
        const wave = Math.sin(t * 2.2 - k * 0.6 + arm.seed);
        if (mode === "jet") {
          // Samlet bag kappen som en raket, med en let bølgen
          arm.path[k].set(-jet.x * k * seg + out.x * 0.12 * (1 - f) + wave * 0.04 * f, 0.4 - jet.y * k * seg, -jet.z * k * seg + out.z * 0.12 * (1 - f));
        } else {
          // Spredt ud over sandet; spidserne krøller op og bølger
          const curl = f * f * (1.2 + 0.6 * wave);
          const reach = k * seg * (1 - 0.15 * f);
          const side = new Vector3(-out.z, 0, out.x).scale(Math.sin(curl) * 0.35 * f);
          arm.path[k].set(out.x * reach + side.x, 0.35 * (1 - f) + 0.05 + Math.max(0, Math.sin(curl)) * 0.25 * f, out.z * reach + side.z);
        }
      }
      MeshBuilder.CreateTube(null, { path: arm.path, radiusFunction: arm.radius, instance: arm.mesh });
    }
  }

  return {
    roots: [root],
    ready: true,
    done: false,
    start() {
      t = 0;
      this.done = false;
      inked = false;
      dir = Math.random() < 0.5 ? 1 : -1;
      root.position.set(Scalar.RandomRange(-9, 9), FLOOR_Y, Scalar.RandomRange(1, 5));
      root.rotation.set(0, dir > 0 ? 0 : Math.PI, 0);
      mantleNode.rotation.set(0, 0, 0);
      skin.diffuseColor.copyFrom(CAMO);
      jet.set(0, 0, 0);
      root.setEnabled(true);
      aquarium.threats.push(threat);
    },
    update(dt) {
      t += dt;
      const p = root.position;
      let mode = "crawl";
      if (t < 4) {
        // Træder frem fra camouflagen
        for (const m of parts) m.visibility = t / 4;
      } else if (t < 8) {
        Color3.LerpToRef(CAMO, VIVID, (t - 4) / 4, skin.diffuseColor);
      } else if (t < 24) {
        // Kravler roligt; farven pulserer mellem lys og mørk
        p.x += dir * 0.35 * dt;
        Color3.LerpToRef(VIVID, DARK, 0.5 + 0.5 * Math.sin(t * 1.3), skin.diffuseColor);
      } else if (t < 25) {
        // Forskrækket: blinker bleg og sprøjter blæk
        Color3.LerpToRef(VIVID, PALE, Math.abs(Math.sin((t - 24) * 12)), skin.diffuseColor);
        if (!inked && t >= 24.4) {
          inked = true;
          ink.emitter.copyFrom(p).addInPlaceFromFloats(0, 0.7 * SCALE, 0);
          ink.manualEmitCount = 160;
        }
      } else {
        // Skyder væk op og bagud med kappen forrest
        mode = "jet";
        // Op og væk fra kameraet; modellen er drejet 180°, når den vender mod -X
        worldJet.set(0.25 * dir, 0.8, 0.55).normalize();
        jet.set(0.25, 0.8, 0.55 * dir).normalize();
        const speed = Math.min(9, (t - 25) * 12);
        p.addInPlace(worldJet.scale(speed * dt));
        mantleNode.rotation.z = -Math.atan2(jet.x, jet.y);
        mantleNode.rotation.x = Math.atan2(jet.z, jet.y);
        skin.diffuseColor.copyFrom(PALE);
        const fade = Math.max(0, 1 - (t - 25) / 2.5);
        for (const m of parts) m.visibility = fade;
        this.done = fade === 0;
      }
      if (mode !== "jet") mantleNode.scaling.y = 1 + Math.sin(t * 1.6) * 0.04; // vejrtrækning
      updateArms(mode);
    },
    stop() {
      root.setEnabled(false);
      for (const m of parts) m.visibility = 1;
      const i = aquarium.threats.indexOf(threat);
      if (i >= 0) aquarium.threats.splice(i, 1);
    },
  };
}
