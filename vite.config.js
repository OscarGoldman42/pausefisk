import { defineConfig } from "vite";
import { cpSync } from "node:fs";

export default defineConfig({
  // Relative stier, så siden virker uanset hvilken mappe den lægges i på web-serveren
  base: "./",
  plugins: [
    {
      // Fiskemodellerne hentes med fetch fra assets/FBX, så Vite kan ikke se dem – kopier dem med i buildet.
      // (Blends/, OBJ/ og babylon-docs/ skal ikke med ud på serveren.)
      name: "copy-fish-models",
      apply: "build",
      closeBundle() {
        cpSync("assets/FBX", "dist/assets/FBX", { recursive: true });
        cpSync("assets/License.txt", "dist/assets/License.txt");
      },
    },
  ],
});
