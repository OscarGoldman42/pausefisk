import { Scalar, TransformNode, Vector3 } from "@babylonjs/core";
import { FLOOR_Y, aquarium } from "../aquarium.js";
import { addEyes, buildCreature, curve, lerpColor, mirrorZ, orient, steer } from "./creature.js";

// En sortspidset revhaj glider forbi. Er stimen der, går den ofte på jagt: den sætter farten op,
// skyder igennem stimen (som splitter op omkring den, fordi hajen er en "trussel") og fortsætter ud.
// ?haj sender den forbi med det samme; ?jagt sender en jagende haj.
// Snuden peger mod +X; halen slår fra side til side.

const TOP = [0.44, 0.48, 0.52];
const BELLY = [0.9, 0.9, 0.88];
const TIP = [0.06, 0.06, 0.08];

function sharkColor({ part, v }) {
  if (part === "tip") return TIP;
  if (part !== "body") return TOP;
  if (v < -0.3) return BELLY;
  return lerpColor(TOP, [0.56, 0.6, 0.63], (0.3 - v) * 1.4);
}

function buildShark(scene) {
  const pectoral = { part: "fin", thickness: [0, 0.008, 0], points: [[0.26, -0.05, 0.08], [0.17, -0.06, 0.085], [0.09, -0.1, 0.2], [0.12, -0.1, 0.22]] };
  const pelvic = { part: "fin", thickness: [0, 0.006, 0], points: [[-0.08, -0.06, 0.03], [-0.13, -0.06, 0.03], [-0.15, -0.09, 0.07]] };
  const vertical = (points, part = "fin") => ({ part, thickness: [0, 0, 0.009], points });
  return buildCreature(scene, "shark", {
    profile: curve([[0, 0.01], [0.04, 0.035], [0.1, 0.065], [0.2, 0.09], [0.32, 0.1], [0.45, 0.09], [0.6, 0.065], [0.75, 0.038], [0.85, 0.022], [0.93, 0.016], [1, 0.01]]),
    width: (t) => (t > 0.7 ? 0.9 - (t - 0.7) * 1.2 : 0.9),
    centerY: (t) => (t > 0.85 ? 0.012 * ((t - 0.85) / 0.15) : 0), // halestilken bøjer lidt op mod den store øvre halefinne
    segments: 14,
    fins: [
      pectoral,
      mirrorZ(pectoral),
      pelvic,
      mirrorZ(pelvic),
      // Første rygfinne: grå forneden, sort spids
      vertical([[0.14, 0.095, 0], [0.07, 0.155, 0], [0.01, 0.16, 0], [-0.02, 0.09, 0]]),
      vertical([[0.07, 0.155, 0], [0.0, 0.205, 0], [-0.01, 0.19, 0], [0.01, 0.16, 0]], "tip"),
      vertical([[-0.2, 0.045, 0], [-0.235, 0.075, 0], [-0.25, 0.04, 0]]), // anden rygfinne
      vertical([[-0.23, -0.035, 0], [-0.26, -0.035, 0], [-0.27, -0.06, 0]]), // gatfinne
      // Halefinnen: stor øvre flig med sort spids, lille nedre flig
      vertical([[-0.45, 0.02, 0], [-0.58, 0.13, 0], [-0.575, 0.07, 0], [-0.55, 0.02, 0], [-0.5, -0.005, 0]]),
      vertical([[-0.58, 0.13, 0], [-0.63, 0.18, 0], [-0.6, 0.1, 0], [-0.575, 0.07, 0]], "tip"),
      vertical([[-0.47, -0.01, 0], [-0.5, -0.01, 0], [-0.58, -0.1, 0], [-0.555, -0.1, 0]]),
    ],
    color: sharkColor,
  });
}

export function createShark(scene) {
  const root = new TransformNode("rareShark", scene);
  const body = buildShark(scene);
  body.parent = root;
  addEyes(scene, body, [0.4, 0.02, 0.05], 0.014);
  root.scaling.setAll(5.5);
  root.setEnabled(false);

  const CRUISE = 2.8;
  const HUNT_SPEED = 7.5;
  const params = new URLSearchParams(location.search);
  let forceHunt = params.has("jagt");

  const shark = { heading: new Vector3(1, 0, 0), bank: 0 };
  const velocity = new Vector3();
  const threat = { position: root.position, radius: 3.5, velocity };
  const target = new Vector3();
  let speed = CRUISE;
  let t = 0;
  let dir = 1;
  let phase = 0;
  let hunting = false;
  let dashTarget = null; // punktet på den anden side af stimen, som hajen sigter efter
  let passed = false;
  let cruiseY = 0;
  let cruiseZ = 0;

  return {
    roots: [root],
    ready: true,
    done: false,
    start() {
      t = 0;
      this.done = false;
      dir = Math.random() < 0.5 ? 1 : -1;
      const school = aquarium.schoolCenter;
      // Den jager kun, mens fiskene svømmer frit
      hunting = !!school && aquarium.mode === "normal" && (forceHunt || Math.random() < 0.6);
      forceHunt = false;
      dashTarget = null;
      passed = false;
      cruiseY = hunting ? school.y + Scalar.RandomRange(-1, 2) : Scalar.RandomRange(-2, 5);
      cruiseZ = hunting ? Scalar.Clamp(school.z + Scalar.RandomRange(-3, 3), 4, 14) : Scalar.RandomRange(9, 16);
      root.position.set(-dir * 42, cruiseY, cruiseZ);
      shark.heading.set(dir, 0, 0);
      shark.bank = 0;
      speed = CRUISE;
      // En jagende haj har en større "skræmme-radius", så stimen splitter op omkring den
      threat.radius = hunting ? 7 : 3.5;
      root.setEnabled(true);
      aquarium.threats.push(threat);
    },
    update(dt) {
      t += dt;
      const p = root.position;
      const school = aquarium.schoolCenter;
      let wanted = CRUISE;

      if (hunting && !passed && school && aquarium.mode === "normal" && t < 25) {
        wanted = HUNT_SPEED;
        if (!dashTarget) {
          target.copyFrom(school);
          // Tæt på: lås et mål gennem stimen og et stykke ud på den anden side
          if (Vector3.Distance(p, school) < 14) {
            const through = school.subtract(p);
            through.y *= 0.3;
            dashTarget = school.add(through.normalize().scaleInPlace(12));
          }
        } else {
          target.copyFrom(dashTarget);
          if (Vector3.Distance(p, dashTarget) < 3) passed = true;
        }
      } else {
        passed = true;
        // Glider videre ud til den anden side
        target.set(dir * 70, Scalar.Lerp(p.y, cruiseY, 0.02), cruiseZ);
      }
      target.z = Math.max(target.z, 4); // ikke helt op i kameraet – så fylder hajen hele skærmen
      target.y = Math.max(target.y, FLOOR_Y + 2);

      steer(shark, p, target, hunting && !passed ? 2 : 1.2, dt);
      speed += (wanted - speed) * Math.min(1, dt * 1.5);
      velocity.copyFrom(shark.heading).scaleInPlace(speed);
      p.addInPlace(velocity.scale(dt));
      p.y = Math.max(p.y, FLOOR_Y + 1.5);
      orient(root, velocity);
      root.rotation.x = shark.bank;

      // Halen slår hurtigere, når den har fart på
      phase += dt * (2.2 + speed * 0.7);
      body.swim(phase, 0.05, true);
      threat.radius = hunting && !passed ? 7 : 3.5;
      this.done = passed && p.x * dir > 50;
      if (t > 90) this.done = true; // sikkerhedsnet
    },
    stop() {
      root.setEnabled(false);
      const i = aquarium.threats.indexOf(threat);
      if (i >= 0) aquarium.threats.splice(i, 1);
    },
  };
}
