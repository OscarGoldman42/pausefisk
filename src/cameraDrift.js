import { Scalar, Vector3 } from "@babylonjs/core";
import { aquarium } from "./aquarium.js";

// Kameraet svajer og glider langsomt, som om man selv flyder i vandet.
// Så snart nogen rører kameraet, stopper driften; efter lidt ro glider den blødt i gang igen.
// Under en sjælden hændelse drejer man blikket mod den – kameraet bliver hvor det er og kigger bare derhen,
// som når man drejer hovedet, i stedet for at svømme efter.

const IDLE_BEFORE_DRIFT = 8; // sekunder uden input før kameraet begynder at drive
const LOOK_SHARE = 0.75; // hvor meget af vinklen hen mod hændelsen blikket drejer
const LOOK_MAX_YAW = 0.3; // radianer til siden (ca. 17°)
const LOOK_MAX_PITCH = 0.12; // radianer op/ned
const LOOK_SPRING = 0.7; // stivheden i blikkets fjeder – lavere er blødere og langsommere
const LOOK_LEAD = 1.5; // sekunder – sigter lidt foran, så blikket ikke hele tiden hænger bagefter
const LIMIT_MARGIN = 0.02; // hold drejningen inden for kameraets vinkelgrænser

export function createCameraDrift(scene, camera, canvas) {
  const home = { alpha: camera.alpha, beta: camera.beta, radius: camera.radius, target: camera.target.clone() };
  // Kroppens stilling (driften) uden blikkets drejning, så drejningen kan lægges ovenpå hver frame
  const body = { alpha: camera.alpha, beta: camera.beta, target: camera.target.clone() };
  const look = { yaw: 0, pitch: 0, yawVel: 0, pitchVel: 0 };
  const lastFocus = new Vector3();
  const focusVel = new Vector3();
  const aim = new Vector3();
  const eye = new Vector3();
  let hadFocus = false;
  let lookApplied = false;
  let idle = IDLE_BEFORE_DRIFT;
  let influence = 1;
  let follow = 0; // 0..1 – toner blikket ind og ud
  let t = 0;

  const wake = () => {
    idle = 0;
    influence = 0;
    // Den som tager fat, overtager kameraet som det ser ud lige nu – drejningen bliver en del af stillingen
    lookApplied = false;
    look.yaw = look.pitch = look.yawVel = look.pitchVel = 0;
    follow = 0;
  };
  canvas.addEventListener("pointerdown", wake);
  canvas.addEventListener("wheel", wake, { passive: true });
  canvas.addEventListener("pointermove", (e) => {
    if (e.buttons) wake();
  });

  // Kameraets plads ud fra mål og vinkler (camera.position opdateres først når der tegnes)
  const eyeOf = (target, alpha, beta, radius) =>
    eye.set(
      target.x + radius * Math.cos(alpha) * Math.sin(beta),
      target.y + radius * Math.cos(beta),
      target.z + radius * Math.sin(alpha) * Math.sin(beta),
    );

  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(scene.getEngine().getDeltaTime() / 1000, 0.05);
    t += dt;
    idle += dt;
    if (idle < IDLE_BEFORE_DRIFT) return;
    influence = Math.min(1, influence + dt / 6); // glid blødt i gang igen

    // Tag blikkets drejning af igen, så driften arbejder på kroppens stilling
    if (lookApplied) {
      camera.alpha = body.alpha;
      camera.beta = body.beta;
      camera.target.copyFrom(body.target);
    }

    // Flere langsomme bølger oven i hinanden, så bevægelsen ikke føles mekanisk
    const alpha = home.alpha + Math.sin(t * 0.045) * 0.28 + Math.sin(t * 0.017 + 1) * 0.12;
    const beta = home.beta + Math.sin(t * 0.06 + 1) * 0.05;
    const radius = home.radius + Math.sin(t * 0.035 + 2) * 2.5;

    const k = Math.min(1, dt * 0.6) * influence;
    camera.alpha += (alpha - camera.alpha) * k;
    camera.beta += (beta - camera.beta) * k;
    camera.radius += (radius - camera.radius) * k;
    // Målet ændres på stedet – camera.target = ... ville regne vinklerne om
    camera.target.addInPlace(home.target.subtract(camera.target).scaleInPlace(k));
    body.alpha = camera.alpha;
    body.beta = camera.beta;
    body.target.copyFrom(camera.target);

    // Hvor skal blikket hen?
    const focus = aquarium.focus;
    if (focus) {
      if (!hadFocus) focusVel.setAll(0);
      else {
        // Et spring (fx når en delfin svømmer ind i billedet og midtpunktet flytter sig) tæller ikke som fart
        const step = focus.subtract(lastFocus);
        if (step.length() < 30 * dt) focusVel.addInPlace(step.scaleInPlace(1 / dt).subtractInPlace(focusVel).scaleInPlace(Math.min(1, dt)));
      }
      lastFocus.copyFrom(focus);
      aim.copyFrom(focus).addInPlace(focusVel.scale(LOOK_LEAD));
    }
    hadFocus = !!focus;
    // Langsom ind- og udtoning, så en kort pause (alle delfinerne ude af billedet et øjeblik) ikke får blikket til at vende om
    follow = Scalar.Clamp(follow + (focus ? dt / 2 : -dt / 4), 0, 1);

    eyeOf(camera.target, camera.alpha, camera.beta, camera.radius);
    let yawGoal = 0;
    let pitchGoal = 0;
    if (follow > 0) {
      // Vinklerne mod målet set fra kameraets plads (samme konvention som alpha/beta)
      const off = eye.subtract(aim);
      const alphaTo = Math.atan2(off.z, off.x);
      const betaTo = Math.acos(Scalar.Clamp(off.y / off.length(), -1, 1));
      yawGoal = Scalar.Clamp(wrap(alphaTo - camera.alpha) * LOOK_SHARE, -LOOK_MAX_YAW, LOOK_MAX_YAW) * follow;
      pitchGoal = Scalar.Clamp((betaTo - camera.beta) * LOOK_SHARE, -LOOK_MAX_PITCH, LOOK_MAX_PITCH) * follow;
    }
    // Inden for kameraets vinkelgrænser, ellers ville Babylon klemme vinklen og kameraet flytte sig
    yawGoal = Scalar.Clamp(yawGoal, camera.lowerAlphaLimit + LIMIT_MARGIN - camera.alpha, camera.upperAlphaLimit - LIMIT_MARGIN - camera.alpha);
    pitchGoal = Scalar.Clamp(pitchGoal, camera.lowerBetaLimit + LIMIT_MARGIN - camera.beta, camera.upperBetaLimit - LIMIT_MARGIN - camera.beta);

    // Kritisk dæmpet fjeder: blikket sætter blødt i gang og bremser blødt op – ingen ryk
    const w = LOOK_SPRING;
    look.yawVel += ((yawGoal - look.yaw) * w * w - 2 * w * look.yawVel) * dt;
    look.pitchVel += ((pitchGoal - look.pitch) * w * w - 2 * w * look.pitchVel) * dt;
    look.yaw += look.yawVel * dt;
    look.pitch += look.pitchVel * dt;

    if (follow === 0 && Math.abs(look.yaw) < 1e-4 && Math.abs(look.pitch) < 1e-4) {
      lookApplied = false;
      return;
    }

    // Drej blikket om kameraets egen plads: kameraet bliver stående, og målet flytter sig i stedet
    camera.alpha += look.yaw;
    camera.beta += look.pitch;
    const r = camera.radius;
    const sb = Math.sin(camera.beta);
    camera.target.set(eye.x - r * Math.cos(camera.alpha) * sb, eye.y - r * Math.cos(camera.beta), eye.z - r * Math.sin(camera.alpha) * sb);
    lookApplied = true;
  });
}

// Vinkelforskel i intervallet -π..π
function wrap(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
