import { Vector3 } from "@babylonjs/core";

// Fælles mål og tilstand for akvariet, som fisk, stime og gæster læser fra

export const FLOOR_Y = -6;

// Området fiskene svømmer i. Det er bredere og højere end det kameraet ser,
// så fiskene kan svømme lidt ud af skærmen og komme tilbage igen.
export const SWIM = {
  min: new Vector3(-22, FLOOR_Y + 1, -4),
  max: new Vector3(22, 10, 14),
};

// Midt i billedet, lidt bag uret
export const GATHER_POINT = new Vector3(0, 3, 6);

export const aquarium = {
  // "normal": fiskene svømmer frit
  // "gather": sidste minut af nedtællingen – fiskene samler sig midt i billedet
  // "digits": de sidste 10 sekunder – stimen danner tallene, de andre fisk trækker ud til siderne
  // "dead": tiden er gået – fiskene dør og falder til bunds med bugen opad (indtil der lægges tid til)
  mode: "normal",
  modeChanged: 0, // tæller der stiger hver gang tilstanden skifter, så fisk kan reagere én gang
  // Store fisk som de andre viger for: { position: Vector3, radius: number, velocity?: Vector3 }
  threats: [],
  // Stimens midtpunkt (sættes af school.js) – hajen sigter efter det, når den jager
  schoolCenter: null,
  // Hvor den igangværende sjældne hændelse er (sættes af rareEvents.js) – kameraet følger den blidt
  focus: null,
  // Tallet stimen skal danne i de sidste 10 sekunder
  digitSeconds: null,
  // Tæller der stiger når tiden rammer 0 – stimen eksploderer ud til alle sider
  burst: 0,

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.modeChanged++;
  },
};
