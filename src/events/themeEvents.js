import { Color4, ParticleSystem, Vector3 } from "@babylonjs/core";
import { aquarium } from "../aquarium.js";
import { createPuffTexture } from "./common.js";

// Hændelser der hører til et bestemt døgn-tema (se `when` i rareEvents.js)

function glowSystem(scene, name, capacity, texture) {
  const ps = new ParticleSystem(name, capacity, scene);
  ps.particleTexture = texture;
  ps.blendMode = ParticleSystem.BLENDMODE_ADD; // lyser op og bliver fanget af bloom
  ps.emitRate = 0;
  ps.start();
  return ps;
}

// ---------- Morild (aften) ----------
// En sky af lysende plankton driver ind. Hvor stimen svømmer igennem, gnistrer det ekstra.
export function createPlankton(scene) {
  const texture = createPuffTexture(scene);
  const glow = glowSystem(scene, "plankton", 3000, texture);
  glow.emitter = new Vector3(0, 2, 10);
  glow.createBoxEmitter(new Vector3(-0.1, -0.05, -0.1), new Vector3(0.1, 0.05, 0.1), new Vector3(-22, -7, -8), new Vector3(22, 6, 8));
  // Toner op, lyser og toner ud igen i løbet af sit liv
  // Lige omkring bloom-tærsklen, så de lyseste gløder en smule uden at overdøve resten af scenen
  glow.addColorGradient(0, new Color4(0.2, 0.7, 1, 0));
  glow.addColorGradient(0.2, new Color4(0.25, 0.85, 1.05, 0.75), new Color4(0.35, 1, 0.85, 0.6));
  glow.addColorGradient(1, new Color4(0.1, 0.4, 0.8, 0));
  glow.minSize = 0.05;
  glow.maxSize = 0.13;
  glow.minLifeTime = 5;
  glow.maxLifeTime = 9;
  glow.minEmitPower = 0.02;
  glow.maxEmitPower = 0.12;
  glow.gravity = new Vector3(0.03, 0.02, 0);

  const sparks = glowSystem(scene, "planktonSparks", 800, texture);
  sparks.emitter = new Vector3();
  sparks.createSphereEmitter(3.5, 1);
  sparks.color1 = new Color4(0.6, 1.3, 1.5, 0.9);
  sparks.color2 = new Color4(0.4, 1.1, 1.4, 0.8);
  sparks.colorDead = new Color4(0.2, 0.6, 1, 0);
  sparks.minSize = 0.08;
  sparks.maxSize = 0.18;
  sparks.minLifeTime = 0.5;
  sparks.maxLifeTime = 1.2;
  sparks.minEmitPower = 0.1;
  sparks.maxEmitPower = 0.4;

  const DURATION = 55;
  let t = 0;

  return {
    roots: [],
    ready: true,
    done: false,
    start() {
      t = 0;
      this.done = false;
    },
    update(dt) {
      t += dt;
      // Tættere og tættere de første sekunder; stopper med at komme nye til de sidste 10 sekunder
      glow.emitRate = t < DURATION - 10 ? Math.min(1, t / 8) * 180 : 0;
      const center = aquarium.schoolCenter;
      if (center && t < DURATION - 10) {
        sparks.emitter.copyFrom(center);
        sparks.emitRate = Math.min(1, t / 8) * 110;
      } else {
        sparks.emitRate = 0;
      }
      this.done = t > DURATION;
    },
    stop() {
      glow.emitRate = 0;
      sparks.emitRate = 0;
    },
  };
}

// ---------- Solglimt (morgen) ----------
// Solen bryder igennem: lysstrålerne og overfladen bliver kraftigere og flimrer,
// og gyldent støv svæver i lyset.
export function createSunburst(scene, { water }) {
  const motes = glowSystem(scene, "sunMotes", 1500, createPuffTexture(scene));
  motes.emitter = new Vector3(0, 5, 10);
  motes.createBoxEmitter(new Vector3(-0.05, -0.1, -0.05), new Vector3(0.05, 0.02, 0.05), new Vector3(-22, -6, -8), new Vector3(22, 7, 10));
  motes.color1 = new Color4(1.5, 1.2, 0.7, 0.8);
  motes.color2 = new Color4(1.3, 1.2, 0.9, 0.6);
  motes.colorDead = new Color4(1, 0.8, 0.5, 0);
  motes.minSize = 0.06;
  motes.maxSize = 0.16;
  motes.minLifeTime = 4;
  motes.maxLifeTime = 8;
  motes.minEmitPower = 0.02;
  motes.maxEmitPower = 0.1;

  const DURATION = 35;
  let t = 0;

  return {
    roots: [],
    ready: true,
    done: false,
    start() {
      t = 0;
      this.done = false;
    },
    update(dt) {
      t += dt;
      // Blød top midt i forløbet, med et let flimmer som når overfladen bølger
      const strength = Math.sin(Math.min(1, t / DURATION) * Math.PI) ** 1.5;
      const shimmer = 1 + 0.12 * Math.sin(t * 2.3) * Math.sin(t * 0.7);
      water.setLightScale(1 + 1.3 * strength * shimmer);
      motes.emitRate = t < DURATION - 6 ? strength * 260 : 0;
      this.done = t > DURATION;
    },
    stop() {
      water.setLightScale(1);
      motes.emitRate = 0;
    },
  };
}
