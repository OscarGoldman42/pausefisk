import { MaterialPluginBase } from "@babylonjs/core";

// Det dansende lysnet (kaustik) fra vandoverfladen – delt mellem bunden (water.js)
// og fisk/sten/tang, så mønstrene passer sammen.

export const causticClock = { time: 0 };

// GLSL: pfCaustics(p, t) giver lysstyrken 0..~1 for punktet p (verdens-xz skaleret)
// To lag animerede Voronoi-kanter i forskellig skala giver det typiske net af lyse linjer.
export const CAUSTICS_GLSL = `
vec2 pfHash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

// Afstand mellem nærmeste og næstnærmeste celle: lille langs cellernes kanter
float pfVoronoiEdge(vec2 x, float t) {
  vec2 n = floor(x);
  vec2 f = fract(x);
  float f1 = 8.0;
  float f2 = 8.0;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 g = vec2(float(i), float(j));
      vec2 o = 0.5 + 0.45 * sin(t + 6.2831 * pfHash2(n + g));
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  return sqrt(f2) - sqrt(f1);
}

float pfCausticLayer(vec2 p, float t) {
  return pow(1.0 - smoothstep(0.0, 0.28, pfVoronoiEdge(p, t)), 3.0);
}

float pfCaustics(vec2 worldXZ, float time) {
  vec2 p = worldXZ * 0.32;
  // Let bølget forvrængning, så linjerne ikke ser geometriske ud
  p += 0.15 * vec2(sin(p.y * 1.7 + time * 0.7), cos(p.x * 1.5 - time * 0.6));
  return pfCausticLayer(p + vec2(time * 0.05, 0.0), time * 0.8) * 0.65
       + pfCausticLayer(p * 1.45 + vec2(0.0, time * 0.04) + 3.1, time * 0.65 + 1.7) * 0.5;
}
`;

// Plugin til StandardMaterial: lægger kaustik på de flader der vender opad og en svag
// lyskant (rim light) langs silhuetten, så fiskene træder frem fra vandet.
// (babylon-docs/features/featuresDeepDive/materials/using/materialPlugins.md)
export class CausticsPlugin extends MaterialPluginBase {
  constructor(material, { caustics = 0.35, rim = 0.3 } = {}) {
    super(material, "Caustics", 200, { PF_CAUSTICS: false });
    this.caustics = caustics;
    this.rim = rim;
    this._enable(true);
  }

  prepareDefines(defines) {
    defines.PF_CAUSTICS = true;
  }

  getClassName() {
    return "CausticsPlugin";
  }

  getUniforms() {
    return {
      ubo: [
        { name: "pfTime", size: 1, type: "float" },
        { name: "pfCausticStrength", size: 1, type: "float" },
        { name: "pfRimStrength", size: 1, type: "float" },
      ],
      fragment: `#ifdef PF_CAUSTICS
        uniform float pfTime;
        uniform float pfCausticStrength;
        uniform float pfRimStrength;
      #endif`,
    };
  }

  bindForSubMesh(uniformBuffer) {
    uniformBuffer.updateFloat("pfTime", causticClock.time);
    uniformBuffer.updateFloat("pfCausticStrength", this.caustics);
    uniformBuffer.updateFloat("pfRimStrength", this.rim);
  }

  getCustomCode(shaderType) {
    if (shaderType !== "fragment") return null;
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef PF_CAUSTICS
        ${CAUSTICS_GLSL}
      #endif`,
      // Før tågen, så effekten forsvinder i disen ligesom resten af fisken
      CUSTOM_FRAGMENT_BEFORE_FOG: `#ifdef PF_CAUSTICS
        float pfUp = clamp(normalW.y * 0.6 + 0.4, 0.0, 1.0);
        color.rgb += vec3(0.55, 0.85, 0.85) * pfCaustics(vPositionW.xz, pfTime) * pfCausticStrength * pfUp;
        float pfRim = pow(1.0 - max(dot(viewDirectionW, normalW), 0.0), 3.0);
        color.rgb += vec3(0.35, 0.7, 0.8) * pfRim * pfRimStrength;
      #endif`,
    };
  }
}
