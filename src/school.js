import { Scalar, Vector3 } from "@babylonjs/core";
import { FLOOR_Y, GATHER_POINT, aquarium } from "./aquarium.js";
import { addThreatAvoidance, animateFish, keepInSwimArea, loadFishTemplate, randomPointIn, spawnFish, updateDeath } from "./fishModels.js";

// En stime små fisk der bevæger sig som én organisme (boids: afstand, retning, sammenhold)
// og følger et usynligt førerpunkt rundt i akvariet.

const NEIGHBOR_RADIUS = 2.6;
const SEPARATION_RADIUS = 0.9;
const MIN_SPEED = 1.4;
const MAX_SPEED = 4.2;

// 5×7-skrift til tallene stimen danner i de sidste 10 sekunder
const GLYPHS = {
  0: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  2: ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
};
const DIGIT_SPACING = 1.0; // afstand mellem "pixels" i tallet
const DIGIT_DISTANCE = 12.5; // hvor langt foran kameraet tallet står
const DIGIT_FISH_SCALE = 1.5; // fiskene vokser lidt i tallet, så det er lettere at læse
const BURST_TIME = 3; // sekunder stimen eksploderer ud, når tiden rammer 0

// Førerpunktet holder sig inden for det synlige område
const LEADER_AREA = {
  min: new Vector3(-16, FLOOR_Y + 2.5, 0),
  max: new Vector3(16, 7, 12),
};

export async function createSchool(scene, { species = "Tetra", count = 40, length = 0.8 } = {}) {
  const container = await loadFishTemplate(scene, species);

  const leader = {
    position: randomPointIn(LEADER_AREA.min, LEADER_AREA.max),
    velocity: new Vector3(),
    target: randomPointIn(LEADER_AREA.min, LEADER_AREA.max),
  };

  const boids = [];
  for (let i = 0; i < count; i++) {
    const f = spawnFish(scene, container, species, length * Scalar.RandomRange(0.9, 1.1));
    f.pivot.position = leader.position.add(new Vector3(Scalar.RandomRange(-3, 3), Scalar.RandomRange(-1.5, 1.5), Scalar.RandomRange(-3, 3)));
    f.velocity = new Vector3(Scalar.RandomRange(-1, 1), 0, Scalar.RandomRange(-1, 1)).normalize().scale(2);
    boids.push(f);
  }

  let orbit = 0;
  let seenBurst = aquarium.burst;
  let burstTime = 0;
  let formationSeconds = null;
  let slots = []; // hver fisks plads i tallet (i kameraets koordinater)
  const camForward = new Vector3();
  const camRight = new Vector3();
  const camUp = new Vector3();
  const formationCenter = new Vector3();

  const steer = new Vector3();
  const tmp = new Vector3();
  const goal = new Vector3();
  const center = new Vector3();

  function updateLeader(dt) {
    if (aquarium.mode === "gather") {
      // Stimen kredser roligt rundt bag uret
      orbit += dt * 0.35;
      goal.set(GATHER_POINT.x + Math.cos(orbit) * 4.5, GATHER_POINT.y + Math.sin(orbit * 1.7) * 0.8, GATHER_POINT.z + Math.sin(orbit) * 2.5);
    } else {
      if (Vector3.DistanceSquared(leader.position, leader.target) < 4) {
        leader.target = randomPointIn(LEADER_AREA.min, LEADER_AREA.max);
      }
      goal.copyFrom(leader.target);
    }
    goal.subtractToRef(leader.position, tmp);
    const len = tmp.length();
    if (len > 0.001) tmp.scaleInPlace(Math.min(2.4, len) / len);
    addThreatAvoidance(leader.position, aquarium.threats, 6, tmp);
    Vector3.LerpToRef(leader.velocity, tmp, Math.min(1, dt * 0.8), leader.velocity);
    leader.position.addInPlace(leader.velocity.scale(dt));
  }

  // Punkterne i tallet: én plads pr. tændt "pixel"; er der flere fisk end pladser, deler de dem
  function buildFormation(seconds) {
    const text = String(seconds);
    const cols = text.length * 5 + (text.length - 1);
    const cells = [];
    [...text].forEach((ch, d) => {
      GLYPHS[ch].forEach((row, r) => {
        [...row].forEach((bit, c) => {
          if (bit === "1") cells.push({ x: (d * 6 + c - (cols - 1) / 2) * DIGIT_SPACING, y: (3 - r) * DIGIT_SPACING });
        });
      });
    });
    const next = [];
    for (let i = 0; i < boids.length; i++) {
      const cell = cells[i % cells.length];
      const extra = i >= cells.length; // ekstra fisk lægger sig lidt forskudt i samme pixel
      next.push({
        x: cell.x + (extra ? Scalar.RandomRange(-0.25, 0.25) : 0),
        y: cell.y + (extra ? Scalar.RandomRange(-0.25, 0.25) : 0),
        z: Scalar.RandomRange(-0.4, 0.4),
      });
    }
    // Giv hver plads til den nærmeste ledige fisk, så de ikke krydser hinanden unødigt
    updateCameraFrame();
    const free = new Set(boids);
    for (const slot of next.sort(() => Math.random() - 0.5)) {
      const world = slotToWorld(slot, tmp);
      let best = null;
      let bestD = Infinity;
      for (const f of free) {
        const d = Vector3.DistanceSquared(f.pivot.position, world);
        if (d < bestD) {
          bestD = d;
          best = f;
        }
      }
      best.slot = slot;
      free.delete(best);
    }
  }

  // Tallet står altid lige foran kameraet, også når det driver
  function updateCameraFrame() {
    const cam = scene.activeCamera;
    cam.getDirectionToRef(new Vector3(0, 0, 1), camForward);
    Vector3.CrossToRef(Vector3.Up(), camForward, camRight);
    camRight.normalize();
    Vector3.CrossToRef(camForward, camRight, camUp);
    formationCenter.copyFrom(cam.globalPosition).addInPlace(camForward.scale(DIGIT_DISTANCE));
  }

  function slotToWorld(slot, out) {
    out.copyFrom(formationCenter);
    out.addInPlace(camRight.scale(slot.x)).addInPlace(camUp.scale(slot.y)).addInPlace(camForward.scale(slot.z));
    return out;
  }

  const target = new Vector3();
  const facing = new Vector3();
  function updateDigit(f, dt) {
    // Fjeder mod pladsen i tallet: hurtigt derhen, men uden at skyde over
    slotToWorld(f.slot, target);
    const p = f.pivot.position;
    const v = f.velocity;
    v.x += ((target.x - p.x) * 30 - v.x * 10) * dt;
    v.y += ((target.y - p.y) * 30 - v.y * 10) * dt;
    v.z += ((target.z - p.z) * 30 - v.z * 10) * dt;
    const speed = v.length();
    if (speed > 14) v.scaleInPlace(14 / speed);
    p.addInPlace(v.scale(dt));
    // Alle fisk i tallet vender samme vej (mod højre på skærmen) og svømmer roligt på stedet
    facing.copyFrom(camRight).scaleInPlace(1.2).addInPlace(v);
    animateFish(f, facing, dt);
    growTo(f, DIGIT_FISH_SCALE, dt);
  }

  function growTo(f, scale, dt) {
    const s = Scalar.Lerp(f.pivot.scaling.x, scale, Math.min(1, dt * 3));
    f.pivot.scaling.setAll(s);
  }

  function update(dt) {
    if (dt <= 0) return;
    const dead = aquarium.mode === "dead";
    updateLeader(dt);

    // Tiden ramte 0: eksplodér ud til alle sider fra tallet
    if (seenBurst !== aquarium.burst) {
      seenBurst = aquarium.burst;
      burstTime = BURST_TIME;
      for (const f of boids) {
        f.pivot.position.subtractToRef(formationCenter, tmp);
        tmp.addInPlaceFromFloats(Scalar.RandomRange(-1, 1), Scalar.RandomRange(-1, 1), Scalar.RandomRange(-1, 1));
        f.velocity.copyFrom(tmp.normalize().scaleInPlace(Scalar.RandomRange(8, 13)));
      }
    }
    burstTime = Math.max(0, burstTime - dt);

    // De sidste 10 sekunder: stimen danner tallet
    const digits = aquarium.mode === "digits" && aquarium.digitSeconds !== null;
    if (digits) {
      if (formationSeconds !== aquarium.digitSeconds) {
        formationSeconds = aquarium.digitSeconds;
        buildFormation(formationSeconds);
      }
      updateCameraFrame();
    } else {
      formationSeconds = null;
    }

    // Stimens midtpunkt – hajen sigter efter det, når den jager
    center.set(0, 0, 0);
    for (const f of boids) center.addInPlace(f.pivot.position);
    center.scaleInPlace(1 / boids.length);
    aquarium.schoolCenter = center;

    for (let i = 0; i < boids.length; i++) {
      const f = boids[i];
      if (updateDeath(f, dt, dead)) continue;
      if (digits && f.slot) {
        updateDigit(f, dt);
        continue;
      }
      if (f.pivot.scaling.x !== 1) growTo(f, 1, dt);
      const p = f.pivot.position;
      const v = f.velocity;

      if (burstTime > 0) {
        // Eksplosionen: fisken flyver ud og bremser langsomt op, før den finder stimen igen
        v.scaleInPlace(1 - Math.min(1, dt * 0.6));
        p.addInPlace(v.scale(dt));
        keepInSwimArea(p, dt);
        animateFish(f, v, dt);
        continue;
      }

      let n = 0;
      let cx = 0, cy = 0, cz = 0; // sammenhold
      let ax = 0, ay = 0, az = 0; // retning
      let sx = 0, sy = 0, sz = 0; // afstand
      for (let j = 0; j < boids.length; j++) {
        if (i === j) continue;
        const o = boids[j];
        const dx = o.pivot.position.x - p.x;
        const dy = o.pivot.position.y - p.y;
        const dz = o.pivot.position.z - p.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > NEIGHBOR_RADIUS * NEIGHBOR_RADIUS) continue;
        n++;
        cx += dx; cy += dy; cz += dz;
        ax += o.velocity.x; ay += o.velocity.y; az += o.velocity.z;
        if (d2 < SEPARATION_RADIUS * SEPARATION_RADIUS && d2 > 0.0001) {
          const push = (SEPARATION_RADIUS - Math.sqrt(d2)) / d2;
          sx -= dx * push; sy -= dy * push; sz -= dz * push;
        }
      }

      steer.set(0, 0, 0);
      if (n > 0) {
        steer.x += (cx / n) * 0.8 + (ax / n - v.x) * 1.2;
        steer.y += (cy / n) * 0.8 + (ay / n - v.y) * 1.2;
        steer.z += (cz / n) * 0.8 + (az / n - v.z) * 1.2;
      }
      steer.x += sx * 3;
      steer.y += sy * 3;
      steer.z += sz * 3;

      // Følg føreren – stærkere jo længere væk
      leader.position.subtractToRef(p, tmp);
      const dl = tmp.length();
      if (dl > 0.001) steer.addInPlace(tmp.scaleInPlace((Math.min(dl, 6) / dl) * 0.6));

      addThreatAvoidance(p, aquarium.threats, 14, steer);

      v.addInPlace(steer.scaleInPlace(dt));
      v.y *= 1 - Math.min(1, dt * 1.5); // stimer holder sig mest vandret
      const speed = v.length();
      if (speed > MAX_SPEED) v.scaleInPlace(MAX_SPEED / speed);
      else if (speed < MIN_SPEED && speed > 0.0001) v.scaleInPlace(MIN_SPEED / speed);

      p.addInPlace(v.scale(dt));
      keepInSwimArea(p, dt);
      animateFish(f, v, dt);
    }
  }

  // Stimens fisk lyser svagt af sig selv, mens de danner tal (0 = normal, 1 = fuldt lys)
  const baseColors = container.materials.map((m) => m.diffuseColor.clone());
  function setHighlight(k) {
    container.materials.forEach((m, i) => baseColors[i].scaleToRef(0.6 * k, m.emissiveColor));
  }

  return { update, setHighlight };
}
