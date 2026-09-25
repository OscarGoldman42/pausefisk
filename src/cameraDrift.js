// Kameraet svajer og glider langsomt, som om man selv flyder i vandet.
// Så snart nogen rører kameraet, stopper driften; efter lidt ro glider den blødt i gang igen.

const IDLE_BEFORE_DRIFT = 8; // sekunder uden input før kameraet begynder at drive

export function createCameraDrift(scene, camera, canvas) {
  const home = { alpha: camera.alpha, beta: camera.beta, radius: camera.radius };
  let idle = IDLE_BEFORE_DRIFT;
  let influence = 1;
  let t = 0;

  const wake = () => {
    idle = 0;
    influence = 0;
  };
  canvas.addEventListener("pointerdown", wake);
  canvas.addEventListener("wheel", wake, { passive: true });
  canvas.addEventListener("pointermove", (e) => {
    if (e.buttons) wake();
  });

  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(scene.getEngine().getDeltaTime() / 1000, 0.05);
    t += dt;
    idle += dt;
    if (idle < IDLE_BEFORE_DRIFT) return;
    influence = Math.min(1, influence + dt / 6); // glid blødt i gang igen

    // Flere langsomme bølger oven i hinanden, så bevægelsen ikke føles mekanisk
    const alpha = home.alpha + Math.sin(t * 0.045) * 0.28 + Math.sin(t * 0.017 + 1) * 0.12;
    const beta = home.beta + Math.sin(t * 0.06 + 1) * 0.05;
    const radius = home.radius + Math.sin(t * 0.035 + 2) * 2.5;

    const k = Math.min(1, dt * 0.6) * influence;
    camera.alpha += (alpha - camera.alpha) * k;
    camera.beta += (beta - camera.beta) * k;
    camera.radius += (radius - camera.radius) * k;
  });
}
