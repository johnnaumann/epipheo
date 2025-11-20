/* app.js */

/**
 * App-level constants exist here so behavior is predictable and easy to tweak.
 */
const APP_CONSTANTS = {
  appRootId: "app",
  splashId: "splash",
  splashButtonsId: "splash-buttons",
  stageId: "stage",
  slidesUrl: "js/slides.json",
};

/**
 * The application state is simple and serializable so that rendering can be stateless and predictable.
 */
const appState = {
  mode: "BOOT", // 'BOOT' | 'SPLASH' | 'RUNNING'
  config: null,
  pathIndex: null,
  slideIndex: null,
  teardownHandlers: [],
};

/**
 * Bootstraps the application once the DOM is ready so the initial paint is deterministic.
 */
document.addEventListener("DOMContentLoaded", () => {
  initializeApplication();
});

/**
 * Initializes the app by loading the slide configuration, wiring global keys, and rendering.
 * Splash markup exists in HTML; buttons are populated from config.
 */
async function initializeApplication() {
  attachGlobalKeyBindings();
  try {
    const config = await fetchSlidesConfiguration(APP_CONSTANTS.slidesUrl);
    appState.config = config;
    preloadFirstVideoForEachPath();
    buildSplashButtons();
    setState({ mode: "SPLASH", pathIndex: null, slideIndex: null });
  } catch {
    renderFatalError(
      "Unable to load slides. Check that js/slides.json is reachable and valid JSON."
    );
  }
}

/**
 * Loads the slides configuration from a JSON file.
 * Using JSON keeps authorship non-technical and enables simple CMS handoff later.
 *
 * @param {string} url
 * @returns {Promise<Object>}
 */
async function fetchSlidesConfiguration(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) throw new Error("Failed to fetch slides.json");
  const data = await response.json();
  if (!data || !Array.isArray(data.paths))
    throw new Error("Invalid slides.json format");
  return data;
}

/**
 * Centralized state setter to ensure teardown happens before the next render.
 *
 * @param {Object} nextPartialState
 */
function setState(nextPartialState) {
  runTeardownHandlers();
  Object.assign(appState, nextPartialState);
  render();
}

/**
 * Renders the current state. Splash is part of the HTML; stage visibility is toggled here.
 */
function render() {
  const appRoot = getAppRoot();
  const splashRoot = getSplashRoot();
  const stageRoot = getStageRoot();

  if (appState.mode === "SPLASH") {
    splashRoot.hidden = false;
    stageRoot.hidden = true;
    stageRoot.classList.remove("fullscreen");

    const firstButton = splashRoot.querySelector("button");
    if (firstButton) firstButton.focus();
    return;
  }

  if (appState.mode === "RUNNING") {
    splashRoot.hidden = true;
    stageRoot.hidden = false;
    stageRoot.classList.add("fullscreen");

    renderSlide();
    return;
  }

  if (appState.mode === "BOOT") {
    splashRoot.hidden = false;
    stageRoot.hidden = true;
    stageRoot.classList.remove("fullscreen");
    showLoadingOnSplash();
  }
}

/**
 * Shows a loading indicator in the splash button area while the app boots.
 */
function showLoadingOnSplash() {
  const splashButtons = getSplashButtonsRoot();
  clearElement(splashButtons);
  const loader = document.createElement("div");
  loader.className = "loading";
  loader.textContent = "Loading…";
  splashButtons.appendChild(loader);
}

/**
 * Renders a user-facing error when configuration cannot be loaded.
 *
 * @param {string} message
 */
function renderFatalError(message) {
  const appRoot = getAppRoot();
  clearElement(appRoot);
  const container = document.createElement("div");
  container.className = "error";
  const text = document.createElement("p");
  text.textContent = message;
  container.appendChild(text);
  appRoot.appendChild(container);
}

/**
 * Builds one splash button per path using the configuration that has been loaded.
 * Buttons preserve native accessibility and focus behavior across devices.
 */
function buildSplashButtons() {
  const buttonsWrapper = getSplashButtonsRoot();
  clearElement(buttonsWrapper);
  const paths = getPathsConfig();

  paths.forEach((pathDefinition, index) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "splash-button";

    const img = document.createElement("img");
    img.src = pathDefinition.image;
    img.alt = pathDefinition.title || `Path ${index + 1}`;
    img.decoding = "async";
    img.loading = "lazy";
    img.className = "splash-button-img";

    const onSelect = () => selectPath(index);
    btn.addEventListener("click", onSelect);

    btn.appendChild(img);
    buttonsWrapper.appendChild(btn);
  });
}

/**
 * Renders the current slide for the active path.
 * A fixed stage contains one base media layer and any number of overlay layers.
 */
function renderSlide() {
  const stageRoot = getStageRoot();
  const stageInner = stageRoot.querySelector(".stage-inner");
  clearElement(stageInner);

  const currentPath = getPathsConfig()[appState.pathIndex];
  const currentSlide = currentPath.slides[appState.slideIndex];

  const baseMedia = createBaseMediaElement(currentSlide.base);
  stageInner.appendChild(baseMedia);

  if (shouldStageAdvanceOnClick(currentSlide)) {
    const advanceHandler = () => moveToNextSlide();
    stageRoot.addEventListener("click", advanceHandler);
    registerTeardownHandler(() =>
      stageRoot.removeEventListener("click", advanceHandler)
    );
  }

  if (
    currentSlide.advance === "timer" &&
    typeof currentSlide.duration === "number"
  ) {
    const timerId = window.setTimeout(
      () => moveToNextSlide(),
      currentSlide.duration
    );
    registerTeardownHandler(() => window.clearTimeout(timerId));
  }

  if (
    currentSlide.base?.type === "video" &&
    currentSlide.advance === "video-end"
  ) {
    const endedHandler = () => moveToNextSlide();
    baseMedia.addEventListener("ended", endedHandler);
    registerTeardownHandler(() =>
      baseMedia.removeEventListener("ended", endedHandler)
    );
  }

  renderOverlays(stageInner, currentSlide.overlays || []);

  // ---- slide counter ----
  const totalSlides = currentPath.slides.length;
  const counter = document.createElement("div");
  counter.className = "slide-counter";
  counter.textContent = `${appState.slideIndex + 1} / ${totalSlides}`;
  stageInner.appendChild(counter);
  // ------------------------

  preloadNextPrimaryAsset();
  stageRoot.focus({ preventScroll: true });
}

/**
 * Selects a path and starts from its first slide.
 *
 * @param {number} pathIndex
 */
function selectPath(pathIndex) {
  const a = document.getElementById("click1");
  a.currentTime = 0;
  a.play();
  setState({ mode: "RUNNING", pathIndex, slideIndex: 0 });
}

/**
 * Advances to the next slide, or returns to the splash when the path ends.
 */
function moveToNextSlide() {
  const a = document.getElementById("click2");
  a.currentTime = 0;
  a.play();

  // Advance on the next frame so the audio element isn't torn down mid-start
  requestAnimationFrame(() => {
    const paths = getPathsConfig();
    const currentPath = paths[appState.pathIndex];
    const nextIndex = appState.slideIndex + 1;

    if (nextIndex >= currentPath.slides.length) {
      returnToSplash();
      return;
    }

    setState({ mode: "RUNNING", slideIndex: nextIndex });
  });
}

/**
 * Returns to the splash screen to allow users to choose a different path.
 */
function returnToSplash() {
  setState({ mode: "SPLASH", pathIndex: null, slideIndex: null });
}

/**
 * Creates the base media element (image or video) for a slide.
 * Media layout is delegated to CSS so JS remains layout-agnostic.
 *
 * @param {Object} base
 * @returns {HTMLImageElement|HTMLVideoElement|HTMLDivElement}
 */
function createBaseMediaElement(base) {
  if (base?.type === "image") {
    const image = document.createElement("img");
    image.className = "stage-media";
    image.src = base.src || "";
    image.alt = base.alt || "";
    return image;
  }

  if (base?.type === "video") {
    const video = document.createElement("video");
    video.className = "stage-media";
    if (base.poster) video.poster = base.poster;
    video.src = base.src || "";
    video.playsInline = true;
    video.muted = base.muted !== false;
    video.autoplay = true;
    video.controls = base.controls === true;
    video.setAttribute("aria-label", base.caption || "Video");
    video.play().catch(() => {});
    return video;
  }

  const fallback = document.createElement("div");
  fallback.className = "stage-media-fallback";
  fallback.textContent = "Unsupported base media";
  return fallback;
}

/**
 * Renders overlay layers above the base media.
 * Overlays are absolutely positioned in percentages so they scale with the stage.
 *
 * @param {HTMLElement} stageInner
 * @param {Array} overlays
 */
function renderOverlays(stageInner, overlays) {
  overlays.forEach((overlayDefinition) => {
    const overlayElement = createOverlayElement(overlayDefinition);
    stageInner.appendChild(overlayElement);

    if (Array.isArray(overlayDefinition.classList)) {
      overlayDefinition.classList.forEach((cls) =>
        overlayElement.classList.add(cls)
      );
    }

    if (typeof overlayDefinition.showAt === "number") {
      overlayElement.style.visibility = "hidden";
      const showTimerId = window.setTimeout(() => {
        overlayElement.style.visibility = "";
        overlayElement.classList.add("overlay-visible");
      }, overlayDefinition.showAt);
      registerTeardownHandler(() => window.clearTimeout(showTimerId));
    }

    if (typeof overlayDefinition.hideAt === "number") {
      const hideTimerId = window.setTimeout(() => {
        overlayElement.style.visibility = "hidden";
        overlayElement.classList.remove("overlay-visible");
      }, overlayDefinition.hideAt);
      registerTeardownHandler(() => window.clearTimeout(hideTimerId));
    }
  });
}

/**
 * Creates an overlay element according to the JSON schema.
 * Buttons and hotspots are interactive; text and image are presentational.
 *
 * @param {Object} overlayDefinition
 * @returns {HTMLElement}
 */
function createOverlayElement(overlayDefinition) {
  const wrapper = document.createElement("div");
  wrapper.className = `overlay overlay-${overlayDefinition.type || "unknown"}`;
  applyOverlayBox(wrapper, overlayDefinition);

  if (overlayDefinition.type === "text") {
    const text = document.createElement("div");
    text.innerHTML = overlayDefinition.html || "";
    wrapper.appendChild(text);
    return wrapper;
  }

  if (overlayDefinition.type === "image") {
    const image = document.createElement("img");
    image.className = "overlay-image";
    image.src = overlayDefinition.src || "";
    image.alt = overlayDefinition.alt || "";
    wrapper.appendChild(image);
    return wrapper;
  }

  if (overlayDefinition.type === "button") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "overlay-button";
    button.textContent = overlayDefinition.text || "";
    wireOverlayAction(button, overlayDefinition.action);
    wrapper.appendChild(button);
    return wrapper;
  }

  if (overlayDefinition.type === "hotspot") {
    const hotspot = document.createElement("button");
    hotspot.type = "button";
    hotspot.className = "overlay-hotspot";
    hotspot.setAttribute(
      "aria-label",
      overlayDefinition.ariaLabel || "Continue"
    );
    wireOverlayAction(hotspot, overlayDefinition.action);
    wrapper.appendChild(hotspot);
    return wrapper;
  }

  return wrapper;
}

/**
 * Wires an interactive overlay action.
 * Clicks on overlays stop propagation to prevent the stage click handler from also firing.
 *
 * @param {HTMLElement} element
 * @param {string} action
 */
function wireOverlayAction(element, action) {
  if (action === "next") {
    const handler = (event) => {
      event.preventDefault();
      event.stopPropagation();
      moveToNextSlide();
    };
    element.addEventListener("click", handler);
    registerTeardownHandler(() =>
      element.removeEventListener("click", handler)
    );
  }
}

/**
 * Applies percentage-based position and size to an overlay wrapper so it scales with the stage.
 *
 * @param {HTMLElement} element
 * @param {Object} overlayDefinition
 */
function applyOverlayBox(element, overlayDefinition) {
  element.style.position = "absolute";
  if (typeof overlayDefinition.x === "number")
    element.style.left = `${overlayDefinition.x}%`;
  if (typeof overlayDefinition.y === "number")
    element.style.top = `${overlayDefinition.y}%`;
  if (typeof overlayDefinition.w === "number")
    element.style.width = `${overlayDefinition.w}%`;
  if (typeof overlayDefinition.h === "number")
    element.style.height = `${overlayDefinition.h}%`;
}

/**
 * Returns true if the slide defines any interactive overlay (button or hotspot).
 *
 * @param {Object} slide
 * @returns {boolean}
 */
function slideHasInteractiveOverlay(slide) {
  return Array.isArray(slide?.overlays)
    ? slide.overlays.some((o) => o?.type === "button" || o?.type === "hotspot")
    : false;
}

/**
 * Decides whether the entire stage should advance on click for the current slide.
 * If a slide includes any interactive overlays, stage-level click-through is disabled
 * to avoid double-advancing when those controls are used.
 *
 * @param {Object} slide
 * @returns {boolean}
 */
function shouldStageAdvanceOnClick(slide) {
  if (slide.advance === "timer" || slide.advance === "video-end") return false;
  if (slideHasInteractiveOverlay(slide)) return false; // avoid bubbling double-advance
  if (slide.advance === "click") return true;
  return true;
}

/**
 * Preloads the next slide's base media to reduce perceived latency when advancing.
 */
function preloadNextPrimaryAsset() {
  const paths = getPathsConfig();
  const currentPath = paths[appState.pathIndex];
  const nextIndex = appState.slideIndex + 1;

  if (!currentPath || nextIndex >= currentPath.slides.length) return;

  const nextSlide = currentPath.slides[nextIndex];
  if (nextSlide.preloadNext === false) return;

  const base = nextSlide.base || {};
  if (base.type === "image" && base.src) {
    const img = new Image();
    img.src = base.src;
    registerTeardownHandler(() => {});
  } else if (base.type === "video" && base.src) {
    // Fully preload and keep in cache; no teardown to avoid losing buffer.
    preloadVideoSource(base.src);
  }
}

/**
 * Simple registry to ensure we only preload each video src once.
 */
const videoPreloadRegistry = new Set();

/**
 * Ensures a hidden "pool" element exists to hold preloaded media in the DOM.
 * Keeping elements attached makes it more likely the browser retains the buffer.
 *
 * @returns {HTMLElement}
 */
function getOrCreatePreloadPool() {
  let pool = document.getElementById("preload-pool");
  if (!pool) {
    pool = document.createElement("div");
    pool.id = "preload-pool";
    pool.style.position = "fixed";
    pool.style.inset = "0";
    pool.style.width = "0";
    pool.style.height = "0";
    pool.style.overflow = "hidden";
    pool.style.opacity = "0";
    pool.setAttribute("aria-hidden", "true");
    document.body.appendChild(pool);
  }
  return pool;
}

/**
 * Preload a video so it is fully buffered in the background.
 * Uses preload="auto" and a muted play/pause nudge to encourage buffering.
 *
 * @param {string} src
 */
function preloadVideoSource(src) {
  if (!src || videoPreloadRegistry.has(src)) return;
  videoPreloadRegistry.add(src);

  const pool = getOrCreatePreloadPool();

  const video = document.createElement("video");
  video.preload = "auto";
  video.src = src;
  video.muted = true;
  video.playsInline = true;

  // Make sure it never flashes on screen or intercepts pointer events.
  video.style.position = "absolute";
  video.style.width = "1px";
  video.style.height = "1px";
  video.style.opacity = "0";
  video.style.pointerEvents = "none";

  pool.appendChild(video);

  const onCanPlayThrough = () => {
    video.removeEventListener("canplaythrough", onCanPlayThrough);
    // At this point the browser believes it can play through without buffering.
    // We don't need to do anything else; the buffer is kept for future use.
  };
  video.addEventListener("canplaythrough", onCanPlayThrough);

  // Nudge some browsers (especially Safari) to aggressively buffer:
  const playPromise = video.play();
  if (playPromise && typeof playPromise.then === "function") {
    playPromise
      .then(() => {
        video.pause();
        video.currentTime = 0;
      })
      .catch(() => {
        // Autoplay might be blocked; preload="auto" still encourages buffering.
      });
  }
}

/**
 * For each path, find the first slide that uses a video base
 * and preload that video so the initial transition into the path
 * has no visible buffering.
 */
function preloadFirstVideoForEachPath() {
  const paths = getPathsConfig();
  paths.forEach((pathDefinition) => {
    if (!Array.isArray(pathDefinition.slides)) return;

    let firstVideoSrc = null;
    for (const slide of pathDefinition.slides) {
      const base = slide?.base;
      if (base?.type === "video" && base.src) {
        firstVideoSrc = base.src;
        break;
      }
    }

    if (firstVideoSrc) {
      preloadVideoSource(firstVideoSrc);
    }
  });
}

/**
 * Global key bindings for quick navigation and accessibility.
 * ESC returns to splash; Space/Enter/ArrowRight advance when running.
 */
function attachGlobalKeyBindings() {
  const handler = (event) => {
    const isTyping = ["INPUT", "TEXTAREA"].includes(event.target.tagName);
    if (isTyping) return;

    if (event.key === "Escape") {
      returnToSplash();
      return;
    }

    if (appState.mode === "RUNNING") {
      if (
        event.key === " " ||
        event.key === "Enter" ||
        event.key === "ArrowRight"
      ) {
        event.preventDefault();
        moveToNextSlide();
      }
    }
  };

  document.addEventListener("keydown", handler);
  registerTeardownHandler(() =>
    document.removeEventListener("keydown", handler)
  );
}

/**
 * Returns the array of path configurations from the loaded JSON.
 *
 * @returns {Array}
 */
function getPathsConfig() {
  return appState.config?.paths || [];
}

/**
 * Returns the root element for the app.
 *
 * @returns {HTMLElement}
 */
function getAppRoot() {
  const element = document.getElementById(APP_CONSTANTS.appRootId);
  if (!element)
    throw new Error(
      `Missing root element with id="${APP_CONSTANTS.appRootId}"`
    );
  return element;
}

/**
 * Returns the splash section element.
 *
 * @returns {HTMLElement}
 */
function getSplashRoot() {
  const el = document.getElementById(APP_CONSTANTS.splashId);
  if (!el)
    throw new Error(`Missing splash element id="${APP_CONSTANTS.splashId}"`);
  return el;
}

/**
 * Returns the splash buttons container element.
 *
 * @returns {HTMLElement}
 */
function getSplashButtonsRoot() {
  const el = document.getElementById(APP_CONSTANTS.splashButtonsId);
  if (!el)
    throw new Error(
      `Missing splash buttons element id="${APP_CONSTANTS.splashButtonsId}"`
    );
  return el;
}

/**
 * Returns the stage element that contains slide content.
 *
 * @returns {HTMLElement}
 */
function getStageRoot() {
  const el = document.getElementById(APP_CONSTANTS.stageId);
  if (!el)
    throw new Error(`Missing stage element id="${APP_CONSTANTS.stageId}"`);
  return el;
}

/**
 * Registers a teardown handler that is executed before rendering the next state.
 * This prevents timers and listeners from leaking across states.
 *
 * @param {Function} teardownHandler
 */
function registerTeardownHandler(teardownHandler) {
  appState.teardownHandlers.push(teardownHandler);
}

/**
 * Executes and clears all registered teardown handlers in LIFO order.
 * LIFO mirrors how listeners and timers are typically registered during render.
 */
function runTeardownHandlers() {
  while (appState.teardownHandlers.length) {
    const handler = appState.teardownHandlers.pop();
    try {
      handler();
    } catch {
      // Intentionally ignore teardown errors to keep the UI responsive.
    }
  }
}

/**
 * Removes all children from an element to ensure a clean render.
 *
 * @param {HTMLElement} element
 */
function clearElement(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}
