import { Color3, FresnelParameters, MeshBuilder, Scalar, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";

// ---------- Vandmænd ----------
// Øre-vandmænd: en gennemsigtig klokke der er tydeligst i kanten (fresnel), fire lysende
// kønsorganer i en kløverform, flossede mundarme og tynde fangtråde langs kanten.
// Klokken trækker sig hurtigt sammen og slapper langsomt af; hvert pulsslag giver et skub opad,
// og trådene hænger efter bevægelsen.
const DURATION = 55;

export function createJellyfishGroup(scene) {
  const bellMat = new StandardMaterial("jellyBell", scene);
  // Næsten usynlig hvor man ser lige igennem klokken, tydelig og lysende langs kanten.
  // Babylon lægger opacitets-fresnel oveni alpha og ganger emissiv-fresnel på emissiveColor.
  bellMat.diffuseColor = new Color3(0.4, 0.3, 0.55);
  bellMat.emissiveColor = Color3.White();
  bellMat.specularColor = new Color3(0.25, 0.25, 0.3);
  bellMat.specularPower = 64;
  bellMat.alpha = 0.02;
  // Én flade der ses fra begge sider; twoSidedLighting vender normalen på bagsiden, så fresnel virker begge veje
  bellMat.backFaceCulling = false;
  bellMat.twoSidedLighting = true;
  bellMat.separateCullingPass = true; // bagsiden tegnes før forsiden, så den gennemsigtige klokke sorteres rigtigt
  bellMat.opacityFresnelParameters = new FresnelParameters({ leftColor: new Color3(0.85, 0.85, 0.85), rightColor: new Color3(0.1, 0.1, 0.1), power: 1.8, bias: 0 });
  bellMat.emissiveFresnelParameters = new FresnelParameters({ leftColor: new Color3(0.75, 0.55, 1), rightColor: new Color3(0.06, 0.03, 0.12), power: 1.6, bias: 0 });

  const coreMat = new StandardMaterial("jellyCore", scene);
  coreMat.diffuseColor = new Color3(0.95, 0.55, 0.85);
  coreMat.emissiveColor = new Color3(0.5, 0.2, 0.45);
  coreMat.alpha = 0.6;

  const armMat = new StandardMaterial("jellyArms", scene);
  armMat.diffuseColor = new Color3(0.9, 0.7, 0.95);
  armMat.emissiveColor = new Color3(0.35, 0.22, 0.45);
  armMat.alpha = 0.45;
  armMat.backFaceCulling = false;

  const tentacleMat = new StandardMaterial("jellyTentacles", scene);
  tentacleMat.diffuseColor = new Color3(0.7, 0.6, 0.9);
  tentacleMat.emissiveColor = new Color3(0.45, 0.3, 0.6);
  tentacleMat.alpha = 0.35;

  // En stor og tre mindre
  const jellies = [1.25, 0.8, 0.7, 0.6].map((size, i) => createJellyfish(scene, `jelly${i}`, size, { bellMat, coreMat, armMat, tentacleMat }));
  let t = 0;

  return {
    roots: jellies.map((j) => j.root),
    ready: true,
    done: false,
    start() {
      t = 0;
      this.done = false;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const centerX = Scalar.RandomRange(-8, 8);
      for (const j of jellies) j.start(centerX, dir);
    },
    update(dt) {
      t += dt;
      // Toner frem de første sekunder og forsvinder langsomt til sidst
      const fade = Math.min(1, t / 5, (DURATION - t) / 6);
      for (const j of jellies) j.update(dt, Math.max(0, fade));
      this.done = t > DURATION;
    },
    stop() {
      for (const j of jellies) j.stop();
    },
  };
}
function createJellyfish(scene, name, size, mats) {
  const root = new TransformNode(name, scene);
  const bellNode = new TransformNode(`${name}Bell`, scene);
  bellNode.parent = root;

  // Klokken drejes ud fra en profil: kuppel med en let indadbøjet kant
  const profile = [
    [0, 0.5], [0.18, 0.49], [0.34, 0.44], [0.47, 0.35], [0.57, 0.23], [0.63, 0.1], [0.66, 0], [0.64, -0.06], [0.58, -0.08],
  ].map(([x, y]) => new Vector3(x, y, 0));
  const bell = MeshBuilder.CreateLathe(`${name}BellMesh`, { shape: profile, tessellation: 40 }, scene);
  bell.flipFaces(true); // normalerne skal pege udad
  bell.material = mats.bellMat;
  bell.parent = bellNode;

  const parts = [bell];
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    const gonad = MeshBuilder.CreateSphere(`${name}Core`, { diameter: 0.17, segments: 10 }, scene);
    gonad.material = mats.coreMat;
    gonad.parent = bellNode;
    gonad.position.set(Math.cos(a) * 0.15, 0.27, Math.sin(a) * 0.15);
    gonad.scaling.set(1, 0.55, 0.7);
    gonad.rotation.y = -a;
    parts.push(gonad);
  }

  // Trådene genberegnes hver frame (CreateTube med `instance`), så de kan bølge og slæbe efter
  const TENTACLE_POINTS = 14;
  const makeStrand = (meshName, count, radius, mat, radiusFn) => {
    const path = Array.from({ length: count }, (_, k) => new Vector3(0, -k * 0.1, 0));
    const mesh = MeshBuilder.CreateTube(meshName, { path, radius, tessellation: 6, radiusFunction: radiusFn, updatable: true }, scene);
    mesh.material = mat;
    mesh.parent = root;
    parts.push(mesh);
    return { mesh, path, radiusFn };
  };

  const tentacles = Array.from({ length: 16 }, (_, i) => {
    const a = (i / 16) * Math.PI * 2;
    const strand = makeStrand(`${name}Tentacle`, TENTACLE_POINTS, 0.012, mats.tentacleMat, (k) => 0.009 * (1 - k / TENTACLE_POINTS) + 0.002);
    return { ...strand, angle: a, length: Scalar.RandomRange(1.8, 2.8), seed: Math.random() * 10, freq: Scalar.RandomRange(0.9, 1.6) };
  });
  const arms = Array.from({ length: 4 }, (_, i) => {
    const a = (i / 4) * Math.PI * 2;
    // Flosset kant: radius der svinger langs armen
    const strand = makeStrand(`${name}Arm`, 12, 0.06, mats.armMat, (k) => (0.07 - k * 0.004) * (0.7 + 0.3 * Math.sin(k * 2.3)));
    return { ...strand, angle: a, length: 1.1, seed: Math.random() * 10, freq: 1 };
  });

  root.scaling.setAll(size);
  root.setEnabled(false);

  const velocity = new Vector3();
  const period = Scalar.RandomRange(2.2, 3);
  let t = 0;
  let dir = 1;

  function updateStrand(s, rimRadius, rimY, spread, waveAmp) {
    const n = s.path.length;
    const seg = s.length / (n - 1);
    const cos = Math.cos(s.angle);
    const sin = Math.sin(s.angle);
    for (let k = 0; k < n; k++) {
      const f = k / (n - 1);
      // Trådene hænger nedad, spredes når klokken slapper af og slæber efter bevægelsen
      const wave = Math.sin(t * 1.4 * s.freq - k * 0.45 + s.seed) * waveAmp * f;
      const r = rimRadius * (1 + spread * f);
      s.path[k].set(
        cos * r + wave - (velocity.x / size) * f * f * 0.6,
        rimY - k * seg - (velocity.y / size) * f * f * 0.5,
        sin * r + Math.cos(t * 1.1 * s.freq - k * 0.4 + s.seed) * waveAmp * f
      );
    }
    MeshBuilder.CreateTube(null, { path: s.path, radiusFunction: s.radiusFn, instance: s.mesh });
  }

  return {
    root,
    start(centerX, direction) {
      t = Scalar.RandomRange(0, period);
      dir = direction;
      root.position.set(centerX + Scalar.RandomRange(-6, 6), Scalar.RandomRange(-1, 4), Scalar.RandomRange(8, 16));
      root.rotation.set(0, 0, -dir * 0.15);
      velocity.set(dir * 0.3, 0, 0);
      root.setEnabled(true);
    },
    update(dt, fade) {
      t += dt;
      // Pulsslag: hurtig sammentrækning (første 30 %), langsom afslapning
      const p = (t / period) % 1;
      const squeeze = p < 0.3 ? Math.sin((p / 0.3) * Math.PI * 0.5) : Math.pow(1 - (p - 0.3) / 0.7, 2);
      bellNode.scaling.set(1 - 0.2 * squeeze, 1 + 0.14 * squeeze, 1 - 0.2 * squeeze);

      const y = root.position.y;
      const thrust = p < 0.3 ? (y > 8 ? 0.4 : 2.2) : 0;
      velocity.y += (thrust - 0.35) * size * dt; // skub opad under sammentrækningen, synker langsomt imellem
      velocity.y *= Math.exp(-1.5 * dt);
      velocity.x = dir * 0.3;
      root.position.addInPlace(velocity.scale(dt));
      root.rotation.x = Math.sin(t * 0.4) * 0.08;

      const rim = 0.6 * (1 - 0.2 * squeeze);
      for (const s of tentacles) updateStrand(s, rim, -0.05, 0.25 * (1 - squeeze), 0.2);
      for (const s of arms) updateStrand(s, 0.05, 0.02, 1.5, 0.08);

      for (const m of parts) m.visibility = fade;
    },
    stop() {
      root.setEnabled(false);
    },
  };
}

