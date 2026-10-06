import { onXRSelect } from "./vr_native-click.js";

document.addEventListener("DOMContentLoaded", () => {
  const scene = document.querySelector("a-scene");
  const leftController = document.querySelector("#leftHand");
  const rightController = document.querySelector("#rightHand");

  let waitForSessionRafId = null;

  function enableHandTracking(entity) {
    entity.setAttribute("hand-tracking-controls", "");
    entity.removeAttribute("laser-controls");
    entity.setAttribute("visible", true);
    entity.removeAttribute("line"); // Remove laser line
    entity.removeAttribute("raycaster"); // Remove raycaster to avoid orb
  }

  function enableControllers(entity) {
    entity.setAttribute("laser-controls", "model: false");
    entity.setAttribute("raycaster", "objects: .clickable; showLine: true");
    entity.setAttribute(
      "line",
      "color: #FF0000; opacity: 0.75; start: 0 0 -0.01; end: 0 0 -1",
    ); // Small offset
    entity.setAttribute("visible", true);
  }

  function handleXRSession(session) {
    session.addEventListener("inputsourceschange", () => {
      updateHandsVisibility(session.inputSources);
    });

    // Initial check in case input sources are already available
    updateHandsVisibility(session.inputSources);
    session.addEventListener("select", onXRSelect);
  }

  function updateHandsVisibility(inputSources) {
    const sources = Array.from(inputSources);
    const hasHands = sources.some((source) => source.hand);
    const hasControllers = sources.some(
      (source) => source.targetRayMode === "tracked-pointer",
    );

    if (hasHands) {
      enableHandTracking(leftController);
      enableHandTracking(rightController);
    } else if (hasControllers) {
      enableControllers(leftController);
      enableControllers(rightController);
    } else {
      console.warn("No valid input sources detected.");
    }
  }

  function bindXRSessionFromScene() {
    const waitForSession = () => {
      const xrSession = scene.xrSession;
      if (xrSession) {
        waitForSessionRafId = null;
        handleXRSession(xrSession);
        return;
      }
      waitForSessionRafId = window.requestAnimationFrame(waitForSession);
    };

    if (waitForSessionRafId) {
      window.cancelAnimationFrame(waitForSessionRafId);
    }
    waitForSession();
  }

  // Handle XR session start and initialize input handling
  scene.addEventListener("enter-vr", bindXRSessionFromScene);
  scene.addEventListener("enter-ar", bindXRSessionFromScene);

  scene.addEventListener("exit-vr", () => {
    if (waitForSessionRafId) {
      window.cancelAnimationFrame(waitForSessionRafId);
      waitForSessionRafId = null;
    }
    // Reset hands visibility on VR exit if needed
    leftController.setAttribute("visible", false);
    rightController.setAttribute("visible", false);
  });

  scene.addEventListener("exit-ar", () => {
    if (waitForSessionRafId) {
      window.cancelAnimationFrame(waitForSessionRafId);
      waitForSessionRafId = null;
    }
    leftController.setAttribute("visible", false);
    rightController.setAttribute("visible", false);
  });
});
