import { Color3, Color4, DynamicTexture, ParticleSystem, StandardMaterial, Vector3 } from "@babylonjs/core";
import { CausticsPlugin } from "../caustics.js";

// Fælles byggeklodser til de sjældne hændelser

export function material(scene, name, color, { emissive, caustics = 0.3, rim = 0.2, specular = 0.12 } = {}) {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = color;
  mat.ambientColor = color.scale(0.5);
  mat.specularColor = new Color3(specular, specular, specular);
  if (emissive) mat.emissiveColor = emissive;
  new CausticsPlugin(mat, { caustics, rim });
  return mat;
}

export function bubbleSystem(scene, name, texture, capacity) {
  const ps = new ParticleSystem(name, capacity, scene);
  ps.particleTexture = texture;
  ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  ps.color1 = new Color4(0.9, 0.97, 1, 0.8);
  ps.color2 = new Color4(0.8, 0.92, 1, 0.6);
  ps.colorDead = new Color4(0.8, 0.92, 1, 0);
  ps.gravity = new Vector3(0, 0.9, 0);
  ps.minLifeTime = 4;
  ps.maxLifeTime = 6;
  ps.emitRate = 0;
  ps.manualEmitCount = 0;
  return ps;
}

// Blød, rund sky uden kant (til sandskyen)
export function createPuffTexture(scene) {
  const size = 64;
  const texture = new DynamicTexture("puffTexture", size, scene, true);
  texture.hasAlpha = true;
  const ctx = texture.getContext();
  const r = size / 2;
  const g = ctx.createRadialGradient(r, r, 0, r, r, r);
  g.addColorStop(0, "rgba(255,255,255,0.8)");
  g.addColorStop(0.5, "rgba(255,255,255,0.35)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  texture.update();
  return texture;
}
