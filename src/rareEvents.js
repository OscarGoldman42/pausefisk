import { Scalar } from "@babylonjs/core";
import { aquarium } from "./aquarium.js";
import { createDiver } from "./events/diver.js";
import { createJellyfishGroup } from "./events/jellyfish.js";
import { createWreck } from "./events/wreck.js";
import { createWhale, createDolphins, createOrcas } from "./events/cetaceans.js";
import { createCrabs } from "./events/crabs.js";
import { createManta } from "./events/manta.js";
import { createTurtle } from "./events/turtle.js";
import { createOctopus } from "./events/octopus.js";
import { createShark } from "./events/shark.js";
import { createPlankton, createSunburst } from "./events/themeEvents.js";

// Sjældne baggrundshændelser. Én ad gangen, i blandet rækkefølge, så man ser dem alle før nogen gentages.
// Navnet er også parameteren i adressen, fx ?hval, der starter hændelsen med det samme (`aliases` er ekstra navne).
// `when` begrænser en hændelse til et bestemt døgn-tema.
const EVENTS = [
  { name: "dykker", create: createDiver },
  { name: "vandmand", create: createJellyfishGroup },
  { name: "vrag", create: createWreck },
  { name: "hval", create: createWhale },
  { name: "haj", aliases: ["jagt", "gaest"], create: createShark },
  { name: "delfiner", create: createDolphins },
  { name: "spaekhugger", create: createOrcas },
  { name: "krabber", create: createCrabs },
  { name: "rokke", create: createManta },
  { name: "skildpadde", create: createTurtle },
  { name: "blaeksprutte", create: createOctopus },
  { name: "plankton", create: createPlankton, when: () => document.body.dataset.timeTheme === "evening" },
  { name: "solglimt", create: createSunburst, when: () => document.body.dataset.timeTheme === "morning" },
];

// Pauser er ofte 5–10 minutter, og kursisterne er ikke altid i lokalet – så der skal ikke gå længe imellem
const FIRST_DELAY = [15, 30]; // sekunder før den første hændelse
const DELAY = [20, 45]; // sekunder fra en hændelse slutter, til den næste starter
const FADE_OUT = 2.5; // sekunder – når nedtællingen når sidste minut, toner hændelsen ud

export function createRareEvents(scene, context) {
  const events = new Map(EVENTS.map((e) => [e.name, { ...e, event: e.create(scene, context) }]));
  const params = new URLSearchParams(location.search);
  let forced = [...events.values()].find((e) => [e.name, ...(e.aliases ?? [])].some((n) => params.has(n)))?.name;
  let timer = forced ? 3 : Scalar.RandomRange(...FIRST_DELAY);
  let queue = [];
  let active = null;
  let fade = null; // { meshes, time } mens den aktive hændelse toner ud

  // Sidste minut og tallene hører uret og stimen til – der starter ingen hændelser, og en igangværende toner ud
  const quiet = () => aquarium.mode === "gather" || aquarium.mode === "digits";

  function pickNext() {
    if (forced) return events.get(forced);
    for (let tries = 0; tries < 2; tries++) {
      if (queue.length === 0) queue = [...events.values()].sort(() => Math.random() - 0.5);
      const i = queue.findIndex((e) => !e.when || e.when());
      if (i >= 0) return queue.splice(i, 1)[0];
      queue = []; // kun tema-hændelser tilbage, som ikke passer til temaet – bland forfra
    }
    return null;
  }

  function finish() {
    active.stop();
    for (const root of active.roots) for (const m of root.getChildMeshes()) m.visibility = 1;
    active = null;
    fade = null;
    timer = Scalar.RandomRange(...DELAY);
  }

  return {
    update(dt) {
      if (active) {
        active.update(dt);
        if (quiet() && !fade) fade = { meshes: active.roots.flatMap((r) => r.getChildMeshes()), time: 0 };
        if (fade) {
          fade.time += dt;
          const f = Math.max(0, 1 - fade.time / FADE_OUT);
          for (const m of fade.meshes) m.visibility = Math.min(m.visibility, f);
          if (f === 0) return finish();
        }
        if (active.done) finish();
        return;
      }
      if (quiet()) return;
      timer -= dt;
      if (timer > 0) return;
      const next = pickNext();
      if (!next || !next.event.ready) {
        if (next && !forced) queue.unshift(next);
        timer = 2; // en model indlæses stadig – prøv igen om lidt
        return;
      }
      forced = null;
      active = next.event;
      active.start();
    },
  };
}
