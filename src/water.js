import {
  Color3,
  Color4,
  DefaultRenderingPipeline,
  DynamicTexture,
  Effect,
  Mesh,
  MeshBuilder,
  ParticleSystem,
  Scalar,
  ShaderMaterial,
  Vector3,
  Constants,
} from "@babylonjs/core";
import { CAUSTICS_GLSL, causticClock } from "./caustics.js";

// Efterbehandlingen gamma-korrigerer hele billedet; shaderne kompenserer via denne define
// (babylon-docs/features/featuresDeepDive/materials/shaders/image_processing.md)
const SHADER_DEFINES = ["IMAGEPROCESSINGPOSTPROCESS"];

// Undervandsstemning: dybde-gradient, kaustik på bunden, lysstråler, svævende partikler og efterbehandling.
// Shaderne regner selv tåge-dæmpning (samme formel som scene.fogMode EXP2), så effekterne forsvinder i disen.
export function createWater(scene, { floorY, waterColor, fogDensity }) {
  const shared = { time: 0 };
  const materials = [
    createBackdrop(scene, waterColor),
    createCaustics(scene, floorY, fogDensity),
    ...createLightRays(scene, floorY, fogDensity),
    createSurface(scene, fogDensity),
  ];
  createMarineSnow(scene, floorY);
  createPostProcessing(scene);

  scene.onBeforeRenderObservable.add(() => {
    shared.time += scene.getEngine().getDeltaTime() / 1000;
    causticClock.time = shared.time;
    for (const mat of materials) mat.setFloat("time", shared.time);
  });
}

// ---------- Dybde-gradient bag alt ----------
// En stor kugle rundt om kameraet: lysere mod overfladen, mørkere mod dybet. Ved horisonten har den
// præcis tågens farve, så bund og fisk glider sømløst over i den.
Effect.ShadersStore.backdropVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 worldViewProjection;
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  gl_Position = worldViewProjection * vec4(position, 1.0);
}`;

Effect.ShadersStore.backdropFragmentShader = `
precision highp float;
varying vec3 vDir;
uniform vec3 horizon;
uniform vec3 top;
uniform vec3 bottom;
uniform float time;
void main() {
  float y = vDir.y;
  // Under horisonten holdes tågens farve et stykke ned, så den møder den tågede bund uden kant
  vec3 col = y > 0.0 ? mix(horizon, top, pow(y, 0.7)) : mix(horizon, bottom, smoothstep(-0.3, -0.9, y));
  // Svag, langsom lys-bølge oppefra
  float shimmer = sin(vDir.x * 9.0 + time * 0.4) * sin(vDir.z * 7.0 - time * 0.3);
  col += top * 0.06 * max(y, 0.0) * shimmer;
  gl_FragColor = vec4(col, 1.0);
  #include<imageProcessingCompatibility>
}`;

function createBackdrop(scene, waterColor) {
  const mat = new ShaderMaterial("backdropMat", scene, { vertex: "backdrop", fragment: "backdrop" }, {
    attributes: ["position"],
    uniforms: ["worldViewProjection", "horizon", "top", "bottom", "time"],
    defines: SHADER_DEFINES,
  });
  mat.setColor3("horizon", waterColor);
  mat.setColor3("top", new Color3(0.16, 0.5, 0.58));
  mat.setColor3("bottom", new Color3(0.01, 0.07, 0.11));
  mat.backFaceCulling = false;
  mat.disableDepthWrite = true;

  const sphere = MeshBuilder.CreateSphere("backdrop", { diameter: 500, segments: 24, sideOrientation: Mesh.BACKSIDE }, scene);
  sphere.material = mat;
  sphere.infiniteDistance = true;
  sphere.isPickable = false;
  sphere.applyFog = false;
  return mat;
}

// ---------- Kaustik: dansende lysnet på bunden ----------
// Selve mønstret ligger i caustics.js, så fisk og sten får præcis samme lysnet.
Effect.ShadersStore.causticsVertexShader = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec3 vWorld;
void main() {
  vec4 wp = world * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = viewProjection * wp;
}`;

Effect.ShadersStore.causticsFragmentShader = `
precision highp float;
varying vec3 vWorld;
uniform vec3 cameraPosition;
uniform float time;
uniform float fogDensity;

${CAUSTICS_GLSL}

void main() {
  float c = pfCaustics(vWorld.xz, time);

  float dist = length(vWorld - cameraPosition);
  float fog = exp(-pow(dist * fogDensity, 2.0));
  vec3 col = vec3(0.55, 0.85, 0.85) * c * 0.55 * fog;
  gl_FragColor = vec4(col, 1.0);
  #include<imageProcessingCompatibility>
}`;

function createCaustics(scene, floorY, fogDensity) {
  const mat = new ShaderMaterial("causticsMat", scene, { vertex: "caustics", fragment: "caustics" }, {
    attributes: ["position"],
    uniforms: ["world", "viewProjection", "cameraPosition", "time", "fogDensity"],
    defines: SHADER_DEFINES,
    needAlphaBlending: true,
  });
  mat.setFloat("fogDensity", fogDensity);
  mat.alphaMode = Constants.ALPHA_ADD;
  mat.disableDepthWrite = true;
  mat.zOffset = -2; // undgå flimmer mod sandet lige under

  const plane = MeshBuilder.CreateGround("caustics", { width: 300, height: 300 }, scene);
  plane.position.y = floorY + 0.02;
  plane.material = mat;
  plane.isPickable = false;
  return mat;
}

// ---------- Vandoverfladen set nedefra ----------
// En bølgende, lysende flade over fiskene. Kigger man næsten lige op, ses det lyse "vindue" mod himlen
// (Snells vindue); længere ude er det kun bølgernes lysnet. Lægges oveni (additivt), så der ingen kanter er.
const SURFACE_Y = 14;

Effect.ShadersStore.surfaceVertexShader = Effect.ShadersStore.causticsVertexShader;

Effect.ShadersStore.surfaceFragmentShader = `
precision highp float;
varying vec3 vWorld;
uniform vec3 cameraPosition;
uniform float time;
uniform float fogDensity;

${CAUSTICS_GLSL}

void main() {
  vec3 toSurface = vWorld - cameraPosition;
  float dist = length(toSurface);
  float up = toSurface.y / dist; // 1 = lige op

  // Lange, bløde bølger plus et fint lysnet
  vec2 q = vWorld.xz;
  float swell = 0.5 + 0.5 * sin(q.x * 0.18 + time * 0.5) * sin(q.y * 0.23 - time * 0.4);
  float net = pfCaustics(q * 0.55, time * 0.9);
  float window = smoothstep(0.55, 0.9, up); // lyst vindue lige over kameraet

  float light = (0.1 + 0.2 * swell) + net * 0.35 + window * (0.45 + 0.35 * net);
  float fog = exp(-pow(dist * fogDensity * 0.55, 2.0));
  vec3 col = vec3(0.45, 0.78, 0.82) * light * fog;
  gl_FragColor = vec4(col, 1.0);
  #include<imageProcessingCompatibility>
}`;

function createSurface(scene, fogDensity) {
  const mat = new ShaderMaterial("surfaceMat", scene, { vertex: "surface", fragment: "surface" }, {
    attributes: ["position"],
    uniforms: ["world", "viewProjection", "cameraPosition", "time", "fogDensity"],
    defines: SHADER_DEFINES,
    needAlphaBlending: true,
  });
  mat.setFloat("fogDensity", fogDensity);
  mat.alphaMode = Constants.ALPHA_ADD;
  mat.disableDepthWrite = true;
  mat.backFaceCulling = false;

  const surface = MeshBuilder.CreateGround("surface", { width: 400, height: 400 }, scene);
  surface.position.y = SURFACE_Y;
  surface.material = mat;
  surface.isPickable = false;
  return mat;
}

// ---------- Lysstråler oppefra ----------
// Lodrette plader der altid vender mod kameraet (billboard om Y-aksen) med blød, pulserende lysstribe.
Effect.ShadersStore.lightRayVertexShader = `
precision highp float;
attribute vec3 position;
attribute vec2 uv;
uniform mat4 world;
uniform mat4 viewProjection;
varying vec2 vUV;
varying vec3 vWorld;
void main() {
  vec4 wp = world * vec4(position, 1.0);
  vUV = uv;
  vWorld = wp.xyz;
  gl_Position = viewProjection * wp;
}`;

Effect.ShadersStore.lightRayFragmentShader = `
precision highp float;
varying vec2 vUV;
varying vec3 vWorld;
uniform vec3 cameraPosition;
uniform float time;
uniform float phase;
uniform float strength;
uniform float fogDensity;
void main() {
  // Strålen bliver bredere nedad og står lidt skråt
  float center = 0.5 + (1.0 - vUV.y) * 0.12;
  float width = mix(0.18, 0.45, 1.0 - vUV.y);
  float x = abs(vUV.x - center) / width;
  float core = pow(max(0.0, 1.0 - x), 2.2);

  // Striber der glider langsomt, og en langsom puls
  float streaks = 0.65 + 0.35 * sin(vUV.x * 23.0 + time * 0.5 + phase) * sin(vUV.x * 9.0 - time * 0.3);
  float pulse = 0.55 + 0.45 * sin(time * 0.35 + phase);

  // Tonet ud mod top og bund
  float vertical = smoothstep(0.0, 0.55, vUV.y) * smoothstep(1.0, 0.8, vUV.y);

  float dist = length(vWorld - cameraPosition);
  float fog = exp(-pow(dist * fogDensity * 0.6, 2.0));
  float a = core * streaks * pulse * vertical * strength * fog;
  gl_FragColor = vec4(vec3(0.65, 0.9, 0.95) * a, 1.0);
  #include<imageProcessingCompatibility>
}`;

function createLightRays(scene, floorY, fogDensity) {
  const mats = [];
  for (let i = 0; i < 12; i++) {
    const mat = new ShaderMaterial(`lightRayMat${i}`, scene, { vertex: "lightRay", fragment: "lightRay" }, {
      attributes: ["position", "uv"],
      uniforms: ["world", "viewProjection", "cameraPosition", "time", "phase", "strength", "fogDensity"],
      defines: SHADER_DEFINES,
      needAlphaBlending: true,
    });
    mat.setFloat("phase", Math.random() * Math.PI * 2);
    mat.setFloat("strength", Scalar.RandomRange(0.35, 0.6));
    mat.setFloat("fogDensity", fogDensity);
    mat.alphaMode = Constants.ALPHA_ADD;
    mat.disableDepthWrite = true;
    mat.backFaceCulling = false;

    const height = 34;
    const ray = MeshBuilder.CreatePlane(`lightRay${i}`, { width: Scalar.RandomRange(8, 16), height }, scene);
    ray.position.set(Scalar.RandomRange(-30, 30), floorY + height / 2 - 1, Scalar.RandomRange(-2, 30));
    ray.billboardMode = Mesh.BILLBOARDMODE_Y;
    ray.material = mat;
    ray.isPickable = false;
    mats.push(mat);
  }
  return mats;
}

// ---------- Svævende partikler (plankton og støv i vandet) ----------
function createMarineSnow(scene, floorY) {
  const ps = new ParticleSystem("marineSnow", 1500, scene);
  ps.particleTexture = createSoftDotTexture(scene);
  ps.blendMode = ParticleSystem.BLENDMODE_ADD;
  ps.emitter = new Vector3(0, 0, 0);
  ps.createBoxEmitter(new Vector3(-0.1, -0.05, -0.1), new Vector3(0.1, 0.05, 0.1), new Vector3(-36, floorY, -6), new Vector3(36, 16, 40));
  ps.minSize = 0.03;
  ps.maxSize = 0.1;
  ps.minLifeTime = 18;
  ps.maxLifeTime = 30;
  ps.minEmitPower = 0.05;
  ps.maxEmitPower = 0.2;
  ps.emitRate = 60;
  ps.gravity = new Vector3(0, -0.015, 0);
  ps.color1 = new Color4(0.8, 0.95, 0.9, 0.35);
  ps.color2 = new Color4(0.6, 0.85, 0.9, 0.2);
  ps.colorDead = new Color4(0.6, 0.85, 0.9, 0);
  ps.minAngularSpeed = -0.3;
  ps.maxAngularSpeed = 0.3;
  ps.preWarmCycles = 400;
  ps.preWarmStepOffset = 10;
  ps.start();
}

function createSoftDotTexture(scene) {
  const size = 32;
  const texture = new DynamicTexture("softDot", size, scene, false);
  texture.hasAlpha = true;
  const ctx = texture.getContext();
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.4, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  texture.update();
  return texture;
}

// ---------- Efterbehandling ----------
// (babylon-docs/features/featuresDeepDive/postProcesses/defaultRenderingPipeline.md)
function createPostProcessing(scene) {
  const pipeline = new DefaultRenderingPipeline("pipeline", true, scene, [scene.activeCamera]);
  pipeline.samples = 4; // kantudjævning (MSAA)

  pipeline.bloomEnabled = true;
  pipeline.bloomThreshold = 0.85;
  pipeline.bloomWeight = 0.35;
  pipeline.bloomKernel = 64;
  pipeline.bloomScale = 0.5;

  pipeline.imageProcessingEnabled = true;
  const ip = pipeline.imageProcessing;
  ip.vignetteEnabled = true;
  ip.vignetteWeight = 2.2;
  ip.vignetteColor = new Color4(0.0, 0.03, 0.06, 0);
  ip.contrast = 1.15;
  ip.exposure = 1.05;
}
