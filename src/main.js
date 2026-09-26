import {
  Engine,
  Scene,
  ArcRotateCamera,
  HemisphericLight,
  DirectionalLight,
  Vector3,
  Color3,
  Color4,
  Mesh,
  MeshBuilder,
  StandardMaterial,
  Scalar,
  ParticleSystem,
  DynamicTexture,
  NoiseProceduralTexture,
  Frustum,
} from "@babylonjs/core";
import { registerBuiltInLoaders } from "@babylonjs/loaders/dynamic";
import { createWater } from "./water.js";
import { FLOOR_Y, GATHER_POINT, SWIM, aquarium } from "./aquarium.js";
import { addThreatAvoidance, angleDifference, animateFish, keepInSwimArea, loadFishTemplate, randomPointIn, spawnFish, updateDeath } from "./fishModels.js";
import { createSchool } from "./school.js";
import { createRareEvents } from "./rareEvents.js";
import { CausticsPlugin } from "./caustics.js";
import { createCameraDrift } from "./cameraDrift.js";
import { SandRipplePlugin, SwayPlugin, createSeabed } from "./seabed.js";

// Anbefalet måde at registrere loaders på (se babylon-docs/features/featuresDeepDive/importers/loadingFileTypes.md)
registerBuiltInLoaders();

const WATER_COLOR = new Color3(0.02, 0.22, 0.3);
const FOG_DENSITY = 0.022;
const BLADE_SEGMENTS = 12; // segmenter pr. tangblad
// Døgn-temaer: vandets farve (tåge, baggrund mod overflade og dyb), lyset og tonen på lysstrålerne
const TIME_THEMES = {
  morning: {
    fog: new Color3(0.05, 0.28, 0.3),
    top: new Color3(0.34, 0.55, 0.5),
    bottom: new Color3(0.02, 0.08, 0.1),
    rays: new Color3(1.15, 0.95, 0.75),
    hemi: new Color3(0.72, 0.92, 1),
    ground: new Color3(0.12, 0.25, 0.27),
    sun: new Color3(1, 0.72, 0.48),
    sunIntensity: 0.7,
  },
  noon: {
    fog: WATER_COLOR,
    top: new Color3(0.16, 0.5, 0.58),
    bottom: new Color3(0.01, 0.07, 0.11),
    rays: new Color3(1, 1, 1),
    hemi: new Color3(0.8, 0.95, 1),
    ground: new Color3(0.15, 0.25, 0.3),
    sun: new Color3(1, 1, 1),
    sunIntensity: 0.8,
  },
  evening: {
    fog: new Color3(0.14, 0.13, 0.27),
    top: new Color3(0.36, 0.24, 0.45),
    bottom: new Color3(0.03, 0.02, 0.08),
    rays: new Color3(0.8, 0.55, 0.9),
    hemi: new Color3(0.48, 0.58, 0.95),
    ground: new Color3(0.16, 0.11, 0.24),
    sun: new Color3(1, 0.32, 0.18),
    sunIntensity: 0.38,
  },
};

// Arter der svømmer rundt hver for sig: [navn, antal, længde, adfærd]. Tetra svømmer i stime (school.js).
// Adfærd: "anemone" holder sig ved sin søanemone, "bottom" svømmer nede ved bunden,
// "flat" ligger på siden på bunden og glider indimellem et stykke. Uden adfærd svømmer fisken frit.
const SPECIES = [
  ["Clownfish", 3, 1.2, "anemone"],
  ["ZebraClownFish", 2, 1.2, "anemone"],
  ["BlueTang", 2, 1.8],
  ["YellowTang", 2, 1.6],
  ["Tang", 1, 1.7],
  ["Koi", 1, 2.6],
  ["Goldfish", 1, 1.4],
  ["ButterflyFish", 2, 1.6],
  ["MoorishIdol", 2, 1.8],
  ["Puffer", 1, 1.8],
  ["RoyalGramma", 2, 1.0],
  ["CardinalFish", 2, 1.1],
  ["Lionfish", 1, 2.0],
  ["BlackLionFish", 1, 2.0],
  ["Cowfish", 1, 1.4],
  ["ParrotFish", 1, 2.2],
  ["MandarinFish", 2, 1.1, "bottom"],
  ["CoralGrouper", 1, 2.8, "bottom"],
  ["ArmoredCatfish", 1, 1.6, "bottom"],
  ["Flatfish", 1, 2.0, "flat"],
  ["Turbot", 1, 2.2, "flat"],
];

// Akvariet starter med færre fisk. Når en nedtælling eller "kun akvariet" starter, svømmer resten ind
// fra siderne én ad gangen. Klovnefisk og bundfisk bor der i forvejen; kun de frie svømmere kommer til.
const START_SHARE = 0.35; // andel af de frie svømmere, der er der fra start
const ARRIVE_OVER = 150; // sekunder før alle er kommet

let overtime = false;
let moodMix = 0;
let spotMix = 0;
let anemoneCounter = 0; // fordeler klovnefiskene mellem søanemonerne
const OVERTIME_HEMI = new Color3(1, 0.78, 0.7);

const canvas = document.getElementById("renderCanvas");
const engine = new Engine(canvas, true);
const scene = new Scene(engine);

const lights = createEnvironment(scene);
const seabed = createSeabed(scene, { floorY: FLOOR_Y });
const water = createWater(scene, { floorY: FLOOR_Y, waterColor: WATER_COLOR, fogDensity: FOG_DENSITY });
const bubbles = createBubbles(scene);
const [fish, school] = await Promise.all([createFish(scene), createSchool(scene, { species: "Tetra", count: 32, length: 0.8 })]);
const arrivals = createArrivals(fish);
const rareEvents = createRareEvents(scene, { bubbleTexture: bubbles.texture, water });

scene.onBeforeRenderObservable.add(() => {
  const dt = Math.min(engine.getDeltaTime() / 1000, 0.05);
  if (dt <= 0) return; // første frame har dt = 0, og drejehastigheden ville blive NaN
  for (const f of fish) if (!f.away) updateFish(f, dt);
  arrivals.update(dt);
  school.update(dt);
  rareEvents.update(dt);
  updateMood(dt);
});

// Nedtællingen (countdown.js) fortæller akvariet hvad der sker
function applyPhase(phase) {
  if (phase === "overtime" && aquarium.mode === "digits") aquarium.burst++;
  if (phase === "final") aquarium.setMode("gather");
  else if (phase === "digits") aquarium.setMode("digits");
  else if (phase === "overtime" && document.body.dataset.deadFish === "true") aquarium.setMode("dead");
  else aquarium.setMode("normal");
  overtime = phase === "overtime";
}
window.addEventListener("pausefisk:phase", (e) => applyPhase(e.detail.phase));
window.addEventListener("pausefisk:seconds", (e) => (aquarium.digitSeconds = e.detail.seconds));
window.addEventListener("pausefisk:settings", (e) => applyTimeTheme(e.detail.theme));
applyPhase(document.body.dataset.phase ?? "idle");
applyTimeTheme(document.body.dataset.timeTheme ?? "noon");
window.addEventListener("pausefisk:time-added", (e) => bubbles.burst(e.detail.minutes));

engine.runRenderLoop(() => scene.render());
window.addEventListener("resize", () => engine.resize());

function createEnvironment(scene) {
  // Efterbehandlingen gamma-korrigerer, så baggrundsfarven skal angives lineært
  const linearWater = WATER_COLOR.toLinearSpace();
  scene.clearColor = new Color4(linearWater.r, linearWater.g, linearWater.b, 1);
  scene.ambientColor = new Color3(0.3, 0.4, 0.45);

  // Undervands-dis (babylon-docs/features/featuresDeepDive/environment/environment_introduction.md)
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogDensity = FOG_DENSITY;
  scene.fogColor = WATER_COLOR;

  // Kameraet bliver inde i vandet, så man aldrig ser kanten af verdenen
  const camera = new ArcRotateCamera("camera", -Math.PI / 2, 1.28, 20, new Vector3(0, 3.5, 0), scene);
  camera.lowerRadiusLimit = 10;
  camera.upperRadiusLimit = 24;
  camera.lowerAlphaLimit = -Math.PI / 2 - 0.7;
  camera.upperAlphaLimit = -Math.PI / 2 + 0.7;
  camera.lowerBetaLimit = 1.05;
  camera.upperBetaLimit = 1.5;
  camera.wheelDeltaPercentage = 0.01;
  camera.attachControl(canvas, true);
  createCameraDrift(scene, camera, canvas);

  const hemi = new HemisphericLight("hemi", new Vector3(0, 1, 0), scene);
  hemi.intensity = 0.9;
  hemi.diffuse = new Color3(0.8, 0.95, 1);
  hemi.groundColor = new Color3(0.15, 0.25, 0.3);

  const sun = new DirectionalLight("sun", new Vector3(-0.3, -1, 0.2), scene);
  sun.intensity = 0.8;

  // Sandbund – langt større end svømmeområdet, så den forsvinder i disen
  const sand = MeshBuilder.CreateGround("sand", { width: 800, height: 800 }, scene);
  sand.position.y = FLOOR_Y;
  sand.material = colorMaterial("sandMat", new Color3(0.36, 0.33, 0.25), scene);
  new SandRipplePlugin(sand.material);

  // Sten
  const rockMat = colorMaterial("rockMat", new Color3(0.3, 0.32, 0.36), scene);
  new CausticsPlugin(rockMat, { caustics: 0.45, rim: 0 });
  for (let i = 0; i < 25; i++) {
    const rock = MeshBuilder.CreateIcoSphere(`rock${i}`, { radius: Scalar.RandomRange(0.6, 1.6), subdivisions: 1 }, scene);
    rock.scaling.y = Scalar.RandomRange(0.4, 0.8);
    rock.position = randomSeabedPoint(0.2);
    rock.rotation.y = Math.random() * Math.PI;
    rock.material = rockMat;
  }

  createSeaweed(scene);
  return { hemi, sun, theme: TIME_THEMES.noon };
}

function applyTimeTheme(name) {
  const theme = TIME_THEMES[name] ?? TIME_THEMES.noon;
  const linearClear = theme.fog.toLinearSpace();
  scene.clearColor = new Color4(linearClear.r, linearClear.g, linearClear.b, 1);
  scene.fogColor = theme.fog;
  water.setColors({ horizon: theme.fog, top: theme.top, bottom: theme.bottom, light: theme.rays });
  lights.theme = theme;
  lights.hemi.diffuse.copyFrom(theme.hemi);
  lights.hemi.groundColor.copyFrom(theme.ground);
  lights.sun.diffuse.copyFrom(theme.sun);
  lights.sun.intensity = theme.sunIntensity;
}

// Når tiden er overskredet, bliver lyset langsomt en anelse varmere og dæmpet
// De sidste 10 sekunder dæmpes lyset i akvariet, mens stimen lyser op – som et spotlys på tallet
function updateMood(dt) {
  const moodTarget = overtime ? 1 : 0;
  const spotTarget = aquarium.mode === "digits" ? 1 : 0;
  if (moodMix === moodTarget && spotMix === spotTarget) return;
  moodMix = Scalar.Clamp(moodMix + Math.sign(moodTarget - moodMix) * dt / 4, 0, 1);
  spotMix = Scalar.Clamp(spotMix + Math.sign(spotTarget - spotMix) * dt / 0.8, 0, 1);
  Color3.LerpToRef(lights.theme.hemi, OVERTIME_HEMI, moodMix, lights.hemi.diffuse);
  lights.hemi.intensity = 0.9 * (1 - 0.55 * spotMix);
  lights.sun.intensity = (lights.theme.sunIntensity - 0.2 * moodMix) * (1 - 0.6 * spotMix);
  school.setHighlight(spotMix);
}

// Tang: klynger af flade, tilspidsede blade (ribbons) der bøjer mest i toppen og bølger i strømmen.
// (babylon-docs/features/featuresDeepDive/mesh/creation/param/ribbon.md)
function createSeaweed(scene) {
  const mat = new StandardMaterial("seaweedMat", scene);
  mat.diffuseColor = new Color3(1, 1, 1); // farven kommer fra vertex-farverne
  mat.specularColor = new Color3(0.08, 0.1, 0.08);
  mat.backFaceCulling = false;
  mat.twoSidedLighting = true;
  new CausticsPlugin(mat, { caustics: 0.25, rim: 0.1 });
  // Bølgebevægelsen sker på grafikkortet – bladene bygges kun én gang
  new SwayPlugin(mat, { strength: 0.014, speed: 0.9 });

  // Ekstra tang ude i siderne tæt på, hvor kameraet kigger ud, når det driver
  const sidePoint = () => new Vector3((Math.random() < 0.5 ? -1 : 1) * Scalar.RandomRange(16, 38), FLOOR_Y - 0.1, Scalar.RandomRange(-5, 18));
  for (let i = 0; i < 85; i++) {
    const tall = Math.random() < 0.6;
    const count = tall ? randomInt(3, 6) : randomInt(5, 9);
    const parts = [];
    for (let b = 0; b < count; b++) {
      const blade = {
        base: new Vector3(Scalar.RandomRange(-0.4, 0.4), 0, Scalar.RandomRange(-0.4, 0.4)),
        length: tall ? Scalar.RandomRange(4, 10) : Scalar.RandomRange(1, 2.5),
        width: tall ? Scalar.RandomRange(0.35, 0.7) : Scalar.RandomRange(0.12, 0.22),
        angle: Math.random() * Math.PI * 2,
        twist: Scalar.RandomRange(-1.5, 1.5),
        lean: new Vector3(Scalar.RandomRange(-0.3, 0.3), 0, Scalar.RandomRange(-0.3, 0.3)),
        phase: Math.random() * Math.PI * 2,
      };
      blade.amplitude = blade.length * Scalar.RandomRange(0.08, 0.14);
      const ribbon = MeshBuilder.CreateRibbon(`seaweed${i}_${b}`, { pathArray: bladePaths(blade) }, scene);
      ribbon.setVerticesData("color", bladeColors(tall), false);
      parts.push(ribbon);
    }
    // Én mesh pr. klynge, med roden i (0,0,0), så vajningen kan regne med højden over bunden
    const clump = Mesh.MergeMeshes(parts, true, true);
    clump.name = `seaweed${i}`;
    clump.position = i < 55 ? randomSeabedPoint(-0.1) : sidePoint();
    clump.material = mat;
    clump.isPickable = false;
    clump.freezeWorldMatrix();
  }
}

function randomInt(min, max) {
  return Math.floor(Scalar.RandomRange(min, max + 1));
}

// Mørk ved roden, lysere mod spidsen, med lidt variation mellem bladene
function bladeColors(tall) {
  const tint = Scalar.RandomRange(-0.06, 0.06);
  const root = new Color3(0.04, 0.22 + tint, 0.08);
  const tip = tall ? new Color3(0.35 + tint, 0.62 + tint, 0.18) : new Color3(0.25, 0.7 + tint, 0.3);
  const colors = [];
  for (let side = 0; side < 2; side++) {
    for (let j = 0; j <= BLADE_SEGMENTS; j++) {
      const c = Color3.Lerp(root, tip, Math.pow(j / BLADE_SEGMENTS, 0.7));
      colors.push(c.r, c.g, c.b, 1);
    }
  }
  return colors;
}

// Bladets form: bredest lidt over midten, spids i toppen, let bøjet og vredet
function bladePaths(blade) {
  const { base, length, width, amplitude, lean } = blade;
  const paths = [[], []];
  for (let j = 0; j <= BLADE_SEGMENTS; j++) {
    const h = j / BLADE_SEGMENTS;
    const bend = Math.pow(h, 1.6);
    const curve = blade.phase - h * 2.5;
    const sx = (Math.sin(curve) * amplitude + lean.x * length) * bend;
    const sz = (Math.cos(curve * 0.8) * amplitude * 0.6 + lean.z * length) * bend;
    const y = h * length * (1 - 0.15 * bend);
    const w = width * Math.sin(Math.PI * (0.15 + 0.85 * h)) * 0.5;
    const a = blade.angle + blade.twist * h;
    const ox = Math.cos(a) * w;
    const oz = Math.sin(a) * w;
    paths[0].push(new Vector3(base.x + sx - ox, y, base.z + sz - oz));
    paths[1].push(new Vector3(base.x + sx + ox, y, base.z + sz + oz));
  }
  return paths;
}

// Bobler med partikelsystemer (babylon-docs/features/featuresDeepDive/particles/particle_system/)
function createBubbles(scene) {
  const texture = createBubbleTexture(scene);

  // Let vrikken på vej op
  const noise = new NoiseProceduralTexture("bubbleNoise", 128, scene);
  noise.animationSpeedFactor = 2;
  noise.brightness = 0.5;
  noise.octaves = 2;

  const makeSystem = (name, capacity) => {
    const ps = new ParticleSystem(name, capacity, scene);
    ps.particleTexture = texture;
    ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
    ps.color1 = new Color4(0.9, 0.97, 1, 0.7);
    ps.color2 = new Color4(0.8, 0.92, 1, 0.5);
    ps.colorDead = new Color4(0.8, 0.92, 1, 0);
    ps.gravity = new Vector3(0, 0.4, 0);
    ps.noiseTexture = noise;
    ps.noiseStrength = new Vector3(0.6, 0, 0.6);
    ps.preWarmCycles = 300;
    ps.preWarmStepOffset = 5;
    return ps;
  };

  // Spredte små bobler fra hele bunden
  const ambient = makeSystem("ambientBubbles", 600);
  ambient.emitter = new Vector3(0, FLOOR_Y, 0);
  ambient.createBoxEmitter(new Vector3(-0.1, 1, -0.1), new Vector3(0.1, 1, 0.1), new Vector3(-30, 0, -4), new Vector3(30, 0, 30));
  ambient.minSize = 0.06;
  ambient.maxSize = 0.2;
  ambient.minLifeTime = 6;
  ambient.maxLifeTime = 10;
  ambient.minEmitPower = 0.8;
  ambient.maxEmitPower = 1.6;
  ambient.emitRate = 40;
  ambient.start();

  // Et par boble-søjler fra bunden
  for (let i = 0; i < 3; i++) {
    const stream = makeSystem(`bubbleStream${i}`, 200);
    stream.emitter = new Vector3(Scalar.RandomRange(-14, 14), FLOOR_Y, Scalar.RandomRange(2, 16));
    stream.createBoxEmitter(new Vector3(-0.05, 1, -0.05), new Vector3(0.05, 1, 0.05), new Vector3(-0.2, 0, -0.2), new Vector3(0.2, 0, 0.2));
    stream.minSize = 0.1;
    stream.maxSize = 0.35;
    stream.minLifeTime = 5;
    stream.maxLifeTime = 8;
    stream.minEmitPower = 1.5;
    stream.maxEmitPower = 2.5;
    stream.emitRate = 14;
    stream.start();
  }

  // Boblesky når der lægges tid til nedtællingen – større jo flere minutter
  const burstSystem = makeSystem("bubbleBurst", 1200);
  burstSystem.preWarmCycles = 0;
  burstSystem.emitter = new Vector3(0, FLOOR_Y, 6);
  burstSystem.createBoxEmitter(new Vector3(-0.15, 1, -0.15), new Vector3(0.15, 1, 0.15), new Vector3(-9, 0, -4), new Vector3(9, 0, 4));
  burstSystem.minSize = 0.12;
  burstSystem.maxSize = 0.5;
  burstSystem.minLifeTime = 4;
  burstSystem.maxLifeTime = 6.5;
  burstSystem.minEmitPower = 2.5;
  burstSystem.maxEmitPower = 4.5;
  burstSystem.manualEmitCount = 0;
  burstSystem.start();

  return {
    texture,
    burst(minutes) {
      burstSystem.manualEmitCount += 150 + minutes * 80;
    },
  };
}

// Tegner en gennemsigtig boble med lys kant og et lille højlys
function createBubbleTexture(scene) {
  const size = 64;
  const texture = new DynamicTexture("bubbleTexture", size, scene, true);
  texture.hasAlpha = true;
  const ctx = texture.getContext();
  const r = size / 2;

  const body = ctx.createRadialGradient(r, r, 0, r, r, r);
  body.addColorStop(0, "rgba(255,255,255,0.05)");
  body.addColorStop(0.7, "rgba(255,255,255,0.2)");
  body.addColorStop(0.9, "rgba(255,255,255,0.9)");
  body.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = body;
  ctx.fillRect(0, 0, size, size);

  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.arc(r * 0.65, r * 0.65, r * 0.15, 0, Math.PI * 2);
  ctx.fill();

  texture.update();
  return texture;
}

// Tilfældigt punkt på bunden foran kameraet (kameraet står ved -Z og kigger mod +Z)
function randomSeabedPoint(yOffset) {
  return new Vector3(Scalar.RandomRange(-40, 40), FLOOR_Y + yOffset, Scalar.RandomRange(-6, 45));
}

function colorMaterial(name, color, scene) {
  const mat = new StandardMaterial(name, scene);
  mat.diffuseColor = color;
  mat.specularColor = new Color3(0.1, 0.1, 0.1);
  return mat;
}

async function createFish(scene) {
  const all = [];
  await Promise.all(
    SPECIES.map(async ([name, count, length, behaviour]) => {
      const container = await loadFishTemplate(scene, name);
      for (let i = 0; i < count; i++) {
        const size = length * Scalar.RandomRange(0.85, 1.15);
        const f = spawnFish(scene, container, name, size);
        f.behaviour = behaviour;
        if (behaviour === "anemone") f.home = seabed.anemones[(anemoneCounter++) % seabed.anemones.length];
        if (behaviour === "flat") {
          f.flatHeight = size * 0.2; // hvor højt midten ligger over sandet, når fisken ligger på siden
          f.side = Math.random() < 0.5 ? 1 : -1;
          f.rest = Scalar.RandomRange(2, 12);
        }
        const dir = new Vector3(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
        f.cruise = Scalar.RandomRange(1.2, 2.4) * Math.sqrt(1.6 / length) * (behaviour === "anemone" ? 0.7 : 1);
        f.velocity = dir.scale(f.cruise);
        f.heading = Math.atan2(dir.x, dir.z);
        f.target = pickTarget(f);
        f.pivot.position = behaviour === "flat" ? new Vector3(f.target.x, FLOOR_Y + f.flatHeight, f.target.z) : pickTarget(f);
        f.seenMode = aquarium.modeChanged;
        all.push(f);
      }
    })
  );
  return all;
}

function createArrivals(all) {
  const swimmers = all.filter((f) => !f.behaviour).sort(() => Math.random() - 0.5);
  const waiting = swimmers.slice(Math.ceil(swimmers.length * START_SHARE));
  for (const f of waiting) {
    f.away = true;
    f.setEnabled(false);
  }
  const interval = ARRIVE_OVER / Math.max(1, waiting.length);
  // Nedtællingen kan være startet (?min=10), før akvariet er indlæst
  let started = document.body.classList.contains("running") || document.body.classList.contains("aquarium-only");
  window.addEventListener("pausefisk:session", () => (started = true));
  let timer = 4;

  return {
    update(dt) {
      // Ingen nye fisk i finalen eller mens fiskene er døde
      if (!started || waiting.length === 0 || aquarium.mode !== "normal") return;
      timer -= dt;
      if (timer > 0) return;
      swimIn(waiting.shift());
      timer = interval * Scalar.RandomRange(0.6, 1.4);
    },
  };
}

// Fisken starter et stykke uden for billedkanten (regnet ud fra kameraets synsfelt, så det passer til
// enhver skærmbredde og kameravinkel) og svømmer ind mod midten
function swimIn(f) {
  const side = Math.random() < 0.5 ? -1 : 1;
  f.away = false;
  f.entering = true; // må være uden for svømmeområdet, indtil den er kommet ind
  const start = new Vector3(side * 16, Scalar.RandomRange(0, 6), Scalar.RandomRange(-2, 8));
  const planes = Frustum.GetPlanes(scene.getTransformMatrix());
  const MARGIN = 4; // mindst en fiskelængde uden for kanten
  while (planes.every((plane) => plane.dotCoordinate(start) > -MARGIN) && Math.abs(start.x) < 90) start.x += side;
  f.pivot.position.copyFrom(start);
  f.velocity.set(-side * f.cruise, 0, 0);
  f.heading = Math.atan2(f.velocity.x, f.velocity.z);
  f.pivot.rotation.y = f.heading;
  f.target = new Vector3(-side * Scalar.RandomRange(-8, 10), Scalar.RandomRange(0, 7), Scalar.RandomRange(2, 12));
  f.seenMode = aquarium.modeChanged;
  f.setEnabled(true);
}

function randomSwimPoint() {
  return randomPointIn(new Vector3(SWIM.min.x, SWIM.min.y + 1, SWIM.min.z), SWIM.max);
}

// Et punkt i en klump midt i billedet (bag uret) – bruges i nedtællingens sidste minut
function randomGatherPoint() {
  return GATHER_POINT.add(new Vector3(Scalar.RandomRange(-6, 6), Scalar.RandomRange(-2.5, 2.5), Scalar.RandomRange(-3, 4)));
}

// Næste sted fisken vil svømme hen, afhængigt af nedtællingens fase og artens adfærd
function pickTarget(f) {
  if (f.behaviour === "flat") {
    // Et kort stykke hen ad bunden
    const x = Scalar.Clamp((f.target?.x ?? Scalar.RandomRange(-16, 16)) + Scalar.RandomRange(-6, 6), -20, 20);
    const z = Scalar.Clamp((f.target?.z ?? Scalar.RandomRange(0, 12)) + Scalar.RandomRange(-6, 6), -2, 14);
    return new Vector3(x, FLOOR_Y, z);
  }
  if (aquarium.mode === "gather") return randomGatherPoint();
  if (aquarium.mode === "digits") {
    // Træk ud til siderne, så stimens tal står frit midt i billedet
    const side = f.pivot.position.x < 0 ? -1 : 1;
    return new Vector3(side * Scalar.RandomRange(12, 20), Scalar.RandomRange(SWIM.min.y + 1, SWIM.max.y), Scalar.RandomRange(SWIM.min.z, SWIM.max.z));
  }
  if (f.behaviour === "anemone") {
    return f.home.add(new Vector3(Scalar.RandomRange(-2.2, 2.2), Scalar.RandomRange(-0.6, 1.8), Scalar.RandomRange(-2.2, 2.2)));
  }
  if (f.behaviour === "bottom") {
    return new Vector3(Scalar.RandomRange(SWIM.min.x, SWIM.max.x), Scalar.RandomRange(SWIM.min.y, SWIM.min.y + 2), Scalar.RandomRange(SWIM.min.z, SWIM.max.z));
  }
  return randomSwimPoint();
}

const tmp = new Vector3();

function updateFish(f, dt) {
  // Fladfisk ruller selv tilbage på siden, når de vågner igen
  if (f.behaviour === "flat" && f.death && aquarium.mode !== "dead") f.death = null;
  if (updateDeath(f, dt, aquarium.mode === "dead")) return;
  if (f.behaviour === "flat") return updateFlatfish(f, dt);
  const { pivot, velocity } = f;

  // Reager én gang når nedtællingen skifter fase
  if (f.seenMode !== aquarium.modeChanged) {
    f.seenMode = aquarium.modeChanged;
    f.target = pickTarget(f);
  }

  // Nyt mål når fisken er tæt på det nuværende
  if (Vector3.DistanceSquared(pivot.position, f.target) < 1.5) {
    f.target = pickTarget(f);
    if (aquarium.mode !== "gather" && !f.behaviour) f.cruise = Scalar.Clamp(f.cruise * Scalar.RandomRange(0.8, 1.25), 0.8, 3);
  }

  // Styr blødt mod målet – roligere når de samles, hurtigt ud til siderne når stimen danner tal
  const speed = f.cruise * (aquarium.mode === "gather" ? 0.7 : aquarium.mode === "digits" ? 2.2 : 1);
  f.target.subtractToRef(pivot.position, tmp);
  tmp.normalize().scaleInPlace(speed);
  tmp.y *= 0.5;
  addThreatAvoidance(pivot.position, aquarium.threats, 5, tmp);
  Vector3.LerpToRef(velocity, tmp, Math.min(1, dt * 0.9), velocity);
  pivot.position.addInPlace(velocity.scale(dt));

  // En nyankommen fisk holdes ikke inde i svømmeområdet, før den er svømmet ind i det
  if (f.entering && Math.abs(pivot.position.x) < SWIM.max.x - 1) f.entering = false;
  if (!f.entering) keepInSwimArea(pivot.position, dt);

  animateFish(f, velocity, dt);
}

// Fladfisk ligger på siden på bunden, vifter roligt med finnerne og glider indimellem et stykke hen ad sandet
function updateFlatfish(f, dt) {
  const { pivot, velocity } = f;
  const restY = FLOOR_Y + f.flatHeight;
  f.body.rotation.z = Scalar.Lerp(f.body.rotation.z, (f.side * Math.PI) / 2, Math.min(1, dt * 2));
  pivot.rotation.x = Scalar.Lerp(pivot.rotation.x, 0, Math.min(1, dt * 2));

  if (f.rest > 0) {
    // Hviler: næsten stille, kun en langsom bølge i finnerne
    f.rest -= dt;
    velocity.scaleInPlace(1 - Math.min(1, dt * 2));
    f.swim.weight = 1;
    f.fast.weight = 0;
    f.swim.speedRatio = 0.2;
    if (f.rest <= 0) f.target = pickTarget(f);
  } else {
    // Glider hen mod næste hvilested, lige over sandet
    f.target.subtractToRef(pivot.position, tmp);
    tmp.y = 0;
    const dist = tmp.length();
    if (dist < 0.5) {
      f.rest = Scalar.RandomRange(8, 25);
    } else {
      tmp.scaleInPlace(1.3 / dist);
      Vector3.LerpToRef(velocity, tmp, Math.min(1, dt * 1.5), velocity);
      f.heading = Math.atan2(velocity.x, velocity.z);
      pivot.rotation.y = Scalar.Lerp(pivot.rotation.y, pivot.rotation.y + angleDifference(pivot.rotation.y, f.heading), Math.min(1, dt * 3));
      f.swim.speedRatio = 0.9;
    }
  }
  pivot.position.x += velocity.x * dt;
  pivot.position.z += velocity.z * dt;
  const lift = f.rest > 0 ? 0 : 0.25;
  pivot.position.y = Scalar.Lerp(pivot.position.y, restY + lift, Math.min(1, dt * 1.5));
  f.body.position.y = 0;
}
