import { Color3, LoadAssetContainerAsync, Scalar, TransformNode, Vector3 } from "@babylonjs/core";
import { FLOOR_Y, SWIM } from "./aquarium.js";
import { CausticsPlugin } from "./caustics.js";

// Fælles indlæsning og animation af alle fisk (FBX med skelet og svømme-animationer)

const templates = new Map();

// Hver art indlæses én gang og bruges som skabelon
// (babylon-docs/features/featuresDeepDive/importers/assetContainers.md)
export function loadFishTemplate(scene, name) {
  if (!templates.has(name)) {
    templates.set(
      name,
      LoadAssetContainerAsync(`assets/FBX/${name}.fbx`, scene).then((container) => {
        for (const mat of container.materials) {
          brightenFishMaterial(mat);
          new CausticsPlugin(mat, { caustics: 0.35, rim: 0.3 }); // lysnet og lyskant
        }
        return container;
      })
    );
  }
  return templates.get(name);
}

// Laver en fisk ud fra en skabelon. Hierarki: pivot (position + retning) → body (små vip) → model.
export function spawnFish(scene, container, name, length) {
  const id = `${name}_${spawnFish.count++}`;
  const entries = container.instantiateModelsToScene((n) => `${id}_${n}`);
  const model = new TransformNode(`${id}_model`, scene);
  for (const node of entries.rootNodes) node.parent = model;

  // Normaliser størrelse (FBX er i cm) og centrer modellen om pivot'en
  const { min, max } = model.getHierarchyBoundingVectors(true);
  const size = max.subtract(min);
  const center = min.add(max).scale(0.5);
  for (const node of entries.rootNodes) node.position.subtractInPlace(center);
  const scale = length / size.z;
  model.scaling.setAll(scale);

  const body = new TransformNode(`${id}_body`, scene);
  model.parent = body;
  const pivot = new TransformNode(id, scene);
  body.parent = pivot;

  // Rolig og hurtig svømning kører samtidig og blandes med vægte
  // (babylon-docs/features/featuresDeepDive/animation/advanced_animations.md#animation-weights)
  const anim = (clip) => entries.animationGroups.find((g) => g.name.endsWith(`|${clip}`));
  const swim = anim("Swimming_Normal");
  const fast = anim("Swimming_Fast");
  for (const group of entries.animationGroups) group.stop();
  for (const group of [swim, fast]) {
    group.start(true);
    group.goToFrame(Scalar.RandomRange(group.from, group.to)); // så fiskene ikke svømmer i takt
  }
  fast.weight = 0;

  return {
    pivot,
    body,
    swim,
    fast,
    effort: 0,
    heading: 0,
    phase: Math.random() * Math.PI * 2,
    halfHeight: size.y * scale * 0.35, // hvor højt midten ligger over bunden, når fisken ligger på siden/ryggen
    death: null,
    setEnabled(enabled) {
      pivot.setEnabled(enabled);
      for (const group of [swim, fast]) enabled ? group.play(true) : group.pause();
    },
  };
}
spawnFish.count = 0;

// Blender har skrevet lineære farver i modelfilerne, men StandardMaterial forventer gamma-farver.
// Uden konvertering bliver fiskene mørke og grå. Ambient farves med fiskens egen farve,
// så scenens grå ambient-lys ikke lægger et slør over dem.
function brightenFishMaterial(mat) {
  mat.diffuseColor = mat.diffuseColor.toGammaSpace();
  mat.ambientColor = mat.diffuseColor.scale(0.6);
  mat.specularColor = new Color3(0.15, 0.15, 0.15);
  mat.specularPower = 32;
}

// Peg næsen i svømmeretningen og bland animationerne efter fart og drejning.
// `paceScale` bruges til store fisk, hvis hale slår langsommere.
export function animateFish(f, velocity, dt, paceScale = 1) {
  const speed = velocity.length();
  let turnRate = 0;
  if (speed > 0.01) {
    const heading = Math.atan2(velocity.x, velocity.z); // +Z er fremad i Babylon
    turnRate = Math.abs(angleDifference(f.heading, heading)) / dt;
    f.heading = heading;
    f.pivot.rotation.y = heading;
    f.pivot.rotation.x = -Math.asin(Scalar.Clamp(velocity.y / speed, -0.6, 0.6));
  }

  // Jo hurtigere fisken svømmer eller drejer, jo mere blandes der over i den hurtige animation
  const targetEffort = Scalar.Clamp((speed / paceScale - 1.2) / 1.8 + turnRate * 0.8, 0, 1);
  f.effort = Scalar.Lerp(f.effort, targetEffort, Math.min(1, dt * 2));
  f.swim.weight = 1 - f.effort;
  f.fast.weight = f.effort;
  const pace = 0.6 + (speed / paceScale) * 0.35;
  f.swim.speedRatio = pace;
  f.fast.speedRatio = pace * 0.8;

  // Let op/ned-bølge
  f.phase += dt;
  f.body.position.y = Math.sin(f.phase * 1.3) * 0.08;
}

// Når tiden er gået: et sidste spjæt, så går halen i stå, fisken ruller om på ryggen og synker til bunds.
// Kommer der tid igen, vender den sig om og svømmer videre. Returnerer true mens døden styrer fisken.
export function updateDeath(f, dt, dead) {
  if (dead && !f.death) {
    f.death = { delay: Scalar.RandomRange(0, 1.5), t: 0, side: Math.random() < 0.5 ? 1 : -1, landed: false };
  }
  const d = f.death;
  if (!d) return false;

  if (!dead) {
    // Genoplivning: rul tilbage på ret køl, mens den normale svømning tager over
    f.body.rotation.z = Scalar.Lerp(f.body.rotation.z, 0, Math.min(1, dt * 2.5));
    if (Math.abs(f.body.rotation.z) < 0.02) {
      f.body.rotation.z = 0;
      f.death = null;
    }
    return false;
  }

  d.t += dt;
  const v = f.velocity;
  const p = f.pivot.position;

  if (d.t < d.delay) {
    // Sidste desperate spjæt
    f.swim.weight = 0;
    f.fast.weight = 1;
    f.fast.speedRatio = 1.8;
    v.scaleInPlace(1 - Math.min(1, dt * 1.5));
    p.addInPlace(v.scale(dt));
    return true;
  }

  // Halen går i stå, og fisken ruller om på ryggen med en lille slingren
  const k = Math.min(1, (d.t - d.delay) / 1.8);
  const ease = 1 - Math.pow(1 - k, 3);
  f.swim.weight = 1;
  f.fast.weight = 0;
  f.swim.speedRatio = 0.9 * (1 - k);
  const wobble = d.landed ? 0 : Math.sin(d.t * 2.6) * 0.15 * (1 - ease * 0.6);
  f.body.rotation.z = d.side * Math.PI * ease + wobble;
  f.pivot.rotation.x = Scalar.Lerp(f.pivot.rotation.x, 0, Math.min(1, dt * 2));
  f.body.position.y = Scalar.Lerp(f.body.position.y, 0, Math.min(1, dt * 2));

  // Synk langsomt og driv lidt fra side til side, til den ligger på bunden
  if (!d.landed) {
    const drag = 1 - Math.min(1, dt * 1.2);
    v.x *= drag;
    v.z *= drag;
    v.y = Scalar.Lerp(v.y, -1.5, Math.min(1, dt * 0.8));
    p.addInPlace(v.scale(dt));
    p.x += Math.sin(d.t * 1.3) * 0.3 * dt;
    const restY = FLOOR_Y + f.halfHeight;
    if (p.y <= restY) {
      p.y = restY;
      v.set(0, 0, 0);
      d.landed = true;
    }
  }
  return true;
}

// Hold fisken inden for svømmeområdet. Bunden er blød, så genoplivede fisk glider op fra sandet i stedet for at hoppe.
export function keepInSwimArea(p, dt) {
  p.x = Scalar.Clamp(p.x, SWIM.min.x, SWIM.max.x);
  p.z = Scalar.Clamp(p.z, SWIM.min.z, SWIM.max.z);
  p.y = Math.min(p.y, SWIM.max.y);
  if (p.y < SWIM.min.y) p.y += (SWIM.min.y - p.y) * Math.min(1, dt * 1.5);
}

// Skub væk fra store fisk (trusler) inden for deres radius. Lægges til `out`.
// Har truslen fart på, skubbes der til siden for dens bane – så splitter en stime i to omkring den.
export function addThreatAvoidance(position, threats, strength, out) {
  for (const t of threats) {
    let dx = position.x - t.position.x;
    let dy = position.y - t.position.y;
    let dz = position.z - t.position.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    const r = t.radius;
    if (d2 < r * r && d2 > 0.0001) {
      const d = Math.sqrt(d2);
      const v = t.velocity;
      const vl = v ? v.length() : 0;
      if (vl > 0.5) {
        // Fjern komponenten langs truslens bane, så kun sidelæns-flugten er tilbage
        const along = (dx * v.x + dy * v.y + dz * v.z) / vl;
        const px = dx - (v.x / vl) * along;
        const py = dy - (v.y / vl) * along;
        const pz = dz - (v.z / vl) * along;
        const pl = Math.hypot(px, py, pz);
        if (pl > 0.05) {
          dx = (px / pl) * d;
          dy = (py / pl) * d;
          dz = (pz / pl) * d;
        }
      }
      const push = ((1 - d / r) * strength) / d;
      out.x += dx * push;
      out.y += dy * push * 0.5;
      out.z += dz * push;
    }
  }
  return out;
}

// Korteste vinkel mellem to retninger i radianer (-π..π)
export function angleDifference(a, b) {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

export function randomPointIn(min, max) {
  return new Vector3(Scalar.RandomRange(min.x, max.x), Scalar.RandomRange(min.y, max.y), Scalar.RandomRange(min.z, max.z));
}
