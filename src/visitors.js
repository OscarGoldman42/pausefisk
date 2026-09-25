import { Scalar, Vector3 } from "@babylonjs/core";
import { FLOOR_Y, aquarium } from "./aquarium.js";
import { animateFish, loadFishTemplate, spawnFish } from "./fishModels.js";

// Store gæster der med jævne mellemrum glider langsomt forbi i baggrunden.
// Én ad gangen, i tilfældig rækkefølge – de andre fisk viger for dem.

// [art, længde, fart]
const VISITORS = [
  ["Shark", 9, 2.6],
  ["GoblinShark", 8, 2.2],
  ["Swordfish", 7, 3.2],
  ["Sunfish", 6, 1.4],
  ["Humphead", 5.5, 1.6],
  ["Tuna", 5, 3.4],
];

const START_X = 50; // uden for skærmen i begge sider
const HUNTERS = ["Shark", "GoblinShark"];
const HUNT_SPEED = 7;
const FIRST_DELAY = [20, 40]; // sekunder før den første gæst
const DELAY = [60, 140]; // sekunder mellem gæsterne

export function createVisitors(scene) {
  const pool = new Map(); // art → færdig fisk, genbruges
  let active = null;
  let queue = [];
  // ?gaest i adressen sender den første gæst forbi med det samme; ?jagt sender en jagende haj (til demo)
  const params = new URLSearchParams(location.search);
  let forceHunt = params.has("jagt");
  let timer = params.has("gaest") || forceHunt ? 3 : Scalar.RandomRange(...FIRST_DELAY);

  // Hent modellerne i baggrunden, så de er klar når de skal bruges
  for (const [name, length] of VISITORS) {
    loadFishTemplate(scene, name).then((container) => {
      const f = spawnFish(scene, container, name, length);
      f.setEnabled(false);
      pool.set(name, f);
    });
  }

  function nextVisitor() {
    if (queue.length === 0) queue = [...VISITORS].sort(() => Math.random() - 0.5);
    if (forceHunt) queue.unshift(VISITORS.find(([n]) => n === "Shark"));
    const [name, length, speed] = queue.shift();
    const f = pool.get(name);
    if (!f) return null; // ikke indlæst endnu – prøv igen senere

    // En haj går af og til på jagt efter stimen – men kun mens fiskene svømmer frit
    const school = aquarium.schoolCenter;
    f.hunt = HUNTERS.includes(name) && aquarium.mode === "normal" && school && (forceHunt || Math.random() < 0.5);
    f.passed = false;
    forceHunt = false;

    const dir = Math.random() < 0.5 ? 1 : -1;
    if (f.hunt) {
      f.pivot.position.set(-dir * START_X, school.y + Scalar.RandomRange(-1, 2), Scalar.Clamp(school.z + Scalar.RandomRange(-3, 3), 2, 14));
    } else {
      f.pivot.position.set(-dir * START_X, Scalar.RandomRange(FLOOR_Y + 4, 7), Scalar.RandomRange(10, 30));
    }
    f.velocity = new Vector3(dir * speed, 0, Scalar.RandomRange(-0.3, 0.3));
    f.heading = Math.atan2(f.velocity.x, f.velocity.z);
    f.dir = dir;
    f.speed = speed;
    f.time = 0;
    // En jagende haj har en større "skræmme-radius" og fart på, så stimen splitter op omkring den
    f.threat = { position: f.pivot.position, radius: length * 0.8 + (f.hunt ? 6 : 2.5), velocity: f.velocity };
    f.setEnabled(true);
    aquarium.threats.push(f.threat);
    return f;
  }

  function update(dt) {
    if (dt <= 0) return;
    if (!active) {
      timer -= dt;
      if (timer <= 0) {
        active = nextVisitor();
        timer = active ? Scalar.RandomRange(...DELAY) : 5;
      }
      return;
    }

    const f = active;
    f.time += dt;
    if (f.hunt) {
      updateHunt(f, dt);
    } else {
      // Glider roligt på tværs med en blød op/ned-bue
      f.velocity.y = Math.sin(f.time * 0.25) * 0.25;
    }
    f.pivot.position.addInPlace(f.velocity.scale(dt));
    animateFish(f, f.velocity, dt, f.speed / 0.8);

    const p = f.pivot.position;
    if (p.x * f.dir > START_X || Math.abs(p.x) > START_X + 10 || p.z > 60 || p.z < -30) {
      f.setEnabled(false);
      aquarium.threats.splice(aquarium.threats.indexOf(f.threat), 1);
      active = null;
    }
  }

  // Hajen sætter farten op og styrer mod stimens midte; når den er igennem, fortsætter den lige ud
  const toSchool = new Vector3();
  function updateHunt(f, dt) {
    const school = aquarium.schoolCenter;
    if (!f.passed && school && aquarium.mode === "normal") {
      school.subtractToRef(f.pivot.position, toSchool);
      const dist = toSchool.length();
      if (dist < 3 || f.time > 20) {
        f.passed = true; // igennem stimen (eller opgivet) – fortsæt lige ud
      } else {
        const speed = dist < 28 ? HUNT_SPEED : f.speed * 1.4;
        toSchool.scaleInPlace(speed / dist);
        toSchool.y *= 0.5;
        Vector3.LerpToRef(f.velocity, toSchool, Math.min(1, dt * 1.4), f.velocity);
        // Ikke for tæt på kameraet – så fylder hajen hele skærmen
        if (f.pivot.position.z < 4 && f.velocity.z < 0) f.velocity.z *= 0.5;
      }
    } else {
      f.passed = true;
      f.velocity.y *= 1 - Math.min(1, dt);
    }
  }

  return { update };
}
