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
  musicEnabled: true,
  soundEnabled: true,
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
  musicEnabled: true,
  soundEnabled: true,
};

/**
 * Cache of video elements keyed by src so we can
 * preload once and reuse the exact same node when
 * rendering the slide.
 */
const videoElementCache = new Map();

// Track currently playing music and sound effects
const activeMusicElements = new Set();
const activeSoundElements = new Set();
const activeVideoElements = new Set();

// Cache audio elements keyed by src for overlays
const musicAudioCache = new Map();
const soundAudioCache = new Map();

/**
 * Get or create a cached <audio> element for music overlays.
 * @param {string} src
 * @returns {HTMLAudioElement|null}
 */
function getOrCreateMusicAudio(src) {
  if (!src) return null;
  let audio = musicAudioCache.get(src);
  if (!audio) {
    audio = new Audio(src);
    audio.preload = "auto";
    musicAudioCache.set(src, audio);
  }
  return audio;
}

/**
 * Get or create a cached <audio> element for sound overlays.
 * @param {string} src
 * @returns {HTMLAudioElement|null}
 */
function getOrCreateSoundAudio(src) {
  if (!src) return null;
  let audio = soundAudioCache.get(src);
  if (!audio) {
    audio = new Audio(src);
    audio.preload = "auto";
    soundAudioCache.set(src, audio);
  }
  return audio;
}

/**
 * Resolves an audio target:
 * - HTMLElement <audio> instance
 * - string id (e.g., "click1")
 */
function resolveAudioElement(target) {
  if (!target) return null;
  if (target instanceof HTMLAudioElement) return target;
  if (typeof target === "string") {
    const el = document.getElementById(target);
    return el instanceof HTMLAudioElement ? el : null;
  }
  return null;
}

function muteAllVideos(muted) {
  activeVideoElements.forEach((video) => {
    try {
      video.muted = muted;
    } catch {}
  });
}

function pauseAllVideos() {
  activeVideoElements.forEach((video) => {
    try {
      video.pause();
    } catch {}
  });
}

/**
 * Global handler for advancing overlay sequences.
 * When set, overlays with action="next" will advance
 * the current overlay before advancing the slide.
 */
let overlayAdvanceHandler = null;

/**
 * Bootstraps the application once the DOM is ready so the initial paint is deterministic.
 */
document.addEventListener("DOMContentLoaded", () => {
  createGlobalAudioToggles();
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
    buildSplashButtons();

    setTimeout(preloadFirstVideoForEachPath, 500);
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
 * Creates global sound toggle buttons in the top-right corner.
 * They persist across modes (splash + stage) and just update appState for now.
 */
function createGlobalAudioToggles() {
  // Avoid duplicates if initializeApplication is ever re-run.
  if (document.querySelector(".global-audio-controls")) return;

  const container = document.createElement("div");
  container.className = "global-audio-controls";

  // --- Single unified audio button (uses previous "sound" icon) ---
  const soundBtn = document.createElement("button");
  soundBtn.type = "button";
  soundBtn.className = "audio-toggle audio-toggle-sound";
  soundBtn.setAttribute("aria-label", "Toggle audio");
  soundBtn.setAttribute("aria-pressed", "true");
  soundBtn.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 9v6h3l4 4V5L8 9H5zm11.54-2.12 1.41 1.41A5.98 5.98 0 0 1 19 12c0 1.38-.47 2.65-1.26 3.67l-1.41-1.41A3.98 3.98 0 0 0 17 12c0-.92-.32-1.77-.86-2.45zM14.5 7.5 16 6a7.96 7.96 0 0 1 0 12l-1.5-1.5A5.96 5.96 0 0 0 18 12a5.96 5.96 0 0 0-3.5-4.5z"/>
    </svg>
  `;

  soundBtn.addEventListener("click", () => {
    // Unified flag: both music and sounds use this
    const nextEnabled = !appState.soundEnabled;
    appState.soundEnabled = nextEnabled;
    appState.musicEnabled = nextEnabled;

    updateGlobalAudioTogglesUI();

    if (!nextEnabled) {
      // Turning audio OFF: pause/stop everything and mute videos
      pauseMusic();
      pauseSound();
      muteAllVideos(true);
    } else {
      // Turning audio ON: resume and unmute
      resumeMusic();
      resumeSound();
      muteAllVideos(false);
    }
  });

  container.appendChild(soundBtn);
  document.body.appendChild(container);

  // Initial visual + video state
  updateGlobalAudioTogglesUI();
  muteAllVideos(!appState.soundEnabled);
}

/**
 * Syncs UI state (pressed / off styling) with appState flags.
 */
function updateGlobalAudioTogglesUI() {
  const soundBtn = document.querySelector(".audio-toggle-sound");

  if (soundBtn) {
    const on = !!appState.soundEnabled;
    soundBtn.classList.toggle("is-off", !on);
    soundBtn.setAttribute("aria-pressed", on ? "true" : "false");
  }
}

function attachFreezeOnLastFrame(video) {
  if (!video) return;
  let frozen = false;

  const onTimeUpdate = () => {
    if (!video.duration || frozen) return;
    const remaining = video.duration - video.currentTime;
    if (remaining <= 0.05) {
      frozen = true;
      try {
        video.pause();
        video.currentTime = Math.max(video.duration - 0.05, 0);
      } catch {}
      video.removeEventListener("timeupdate", onTimeUpdate);
    }
  };

  video.addEventListener("timeupdate", onTimeUpdate);
}

/**
 * Renders the current slide for the active path.
 * A fixed stage contains one base media layer and any number of overlay layers.
 */
function renderSlide() {
  const stageRoot = getStageRoot();
  const stageInner = stageRoot.querySelector(".stage-inner");
  clearElement(stageInner);
  overlayAdvanceHandler = null;

  const currentPath = getPathsConfig()[appState.pathIndex];
  const currentSlide = currentPath.slides[appState.slideIndex];

  const overlays = currentSlide.overlays || [];

  const hasVideoBase = currentSlide.base?.type === "video";
  if (hasVideoBase) {
    stopMusic();
    stopSound();
  }

  preloadOverlayImagesForSlide(currentSlide);
  preloadOverlayAudioForSlide(currentSlide);

  const baseMedia = createBaseMediaElement(currentSlide.base);
  stageInner.appendChild(baseMedia);

  if (
    currentSlide.base?.type === "video" &&
    currentSlide.advance !== "video-end" &&
    baseMedia instanceof HTMLVideoElement
  ) {
    attachFreezeOnLastFrame(baseMedia);
  }

  const useSequentialOverlays =
    Array.isArray(overlays) &&
    overlays.length > 0 &&
    currentSlide.advance === "click";

  if (useSequentialOverlays) {
    // Sequential overlays: click to step through overlays, then advance slide.
    renderSequentialOverlays(stageRoot, stageInner, overlays);
  } else {
    // Original behavior: stage click advances slide if allowed.
    if (shouldStageAdvanceOnClick(currentSlide)) {
      const advanceHandler = () => goToNextSlideFromUserGesture();
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

    // Timed overlay behavior (for non-sequential slides, if any still use it)
    renderOverlays(stageInner, overlays);
  }

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
  stopMusic();
  playSound("click1");
  setState({ mode: "RUNNING", pathIndex, slideIndex: 0 });
}

/**
 * Advances to the next slide, or returns to the splash when the path ends.
 */
function moveToNextSlide() {
  playSound("click2");

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
 * Advances to the next slide from a direct user gesture
 * (click/keypress), and ensures the new slide's video
 * starts playing inside that same gesture.
 */
function goToNextSlideFromUserGesture() {
  playSound("click2");

  const paths = getPathsConfig();
  const currentPath = paths[appState.pathIndex];
  if (!currentPath) {
    returnToSplash();
    return;
  }

  const nextIndex = appState.slideIndex + 1;
  if (nextIndex >= currentPath.slides.length) {
    returnToSplash();
    return;
  }

  // Synchronous state update & render inside the gesture.
  setState({ mode: "RUNNING", slideIndex: nextIndex });

  // After render, find the base video (if any) and play it.
  try {
    const stageRoot = getStageRoot();
    const stageInner = stageRoot.querySelector(".stage-inner");
    if (!stageInner) return;
    const video = stageInner.querySelector("video.stage-media");
    if (video) {
      const p = video.play();
      if (p && typeof p.then === "function") {
        p.catch(() => {
          // Autoplay might still be blocked; ignore.
        });
      }
    }
  } catch {
    // Ignore any errors here; keep UI responsive.
  }
}

/**
 * Returns to the splash screen to allow users to choose a different path.
 */
function returnToSplash() {
  stopMusic();
  stopSound();
  pauseAllVideos();
  muteAllVideos(true);

  const splashBGMusic = getOrCreateSoundAudio(
    "media/sound/mp3/MusicLoops/SplunkBTM_UI_Music_LOOP.mp3"
  );
  playMusic(splashBGMusic);
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
    const video = getOrCreatePreloadedVideo(base);
    if (!video) {
      const fallback = document.createElement("div");
      fallback.className = "stage-media-fallback";
      fallback.textContent = "Video unavailable";
      return fallback;
    }

    // Ensure stage styling when actually shown.
    video.className = "stage-media";
    video.style.position = "absolute";
    video.style.inset = "0";
    video.style.left = "";
    video.style.top = "";
    video.style.width = "100%";
    video.style.height = "100%";
    video.style.opacity = "";
    video.style.pointerEvents = "";
    video.removeAttribute("preload");

    try {
      video.currentTime = 0;
    } catch {
      // Ignore seek errors on some platforms.
    }

    video.muted = !appState.soundEnabled;

    video.autoplay = true;
    const playPromise = video.play();
    if (playPromise && typeof playPromise.then === "function") {
      playPromise.catch(() => {
        // Autoplay might be blocked; ignore.
      });
    }

    return video;
  }

  const fallback = document.createElement("div");
  fallback.className = "stage-media-fallback";
  fallback.textContent = "Unsupported base media";
  return fallback;
}

/**
 * Sequential overlay renderer.
 * Shows overlays one at a time in index order; each click
 * (stage or overlay "next") advances overlays, then moves to next slide.
 *
 * Overlays with `persistent: true` are rendered once at the start
 * and never removed (good for skip buttons, etc.).
 *
 * For overlays with `autoAdvance: true`, `delay` is interpreted as
 * "how long this overlay stays on screen before automatically
 * advancing to the next overlay".
 *
 * For overlays without `autoAdvance`, `delay` (if present) is a
 * pre-show delay before the overlay appears after the click.
 *
 * @param {HTMLElement} stageRoot
 * @param {HTMLElement} stageInner
 * @param {Array} overlays
 */
function renderSequentialOverlays(stageRoot, stageInner, overlays) {
  if (!Array.isArray(overlays) || overlays.length === 0) return;

  // Sound-only overlays: schedule their audio and never let them
  // participate in click flow.
  const soundOnlyDefs = overlays.filter((o) => o && o.type === "sound");
  soundOnlyDefs.forEach((def) => scheduleSoundOverlay(def));

  // Non-sound overlays are the ones that participate in the
  // sequential flow.
  const nonSoundDefs = overlays.filter((o) => !o || o.type !== "sound");

  // Split overlays into persistent (always visible) and sequential.
  const persistentDefs = nonSoundDefs.filter((o) => o && o.persistent === true);
  const sequenceDefs = nonSoundDefs.filter((o) => o && o.persistent !== true);

  // Render persistent overlays once and never remove them.
  persistentDefs.forEach((overlayDefinition) => {
    const overlayElement = createOverlayElement(overlayDefinition);
    if (Array.isArray(overlayDefinition.classList)) {
      overlayDefinition.classList.forEach((cls) =>
        overlayElement.classList.add(cls)
      );
    }
    stageInner.appendChild(overlayElement);
    // Play any audio tied to this persistent overlay when it appears
    playOverlayAudio(overlayDefinition);
  });

  // If there are no sequential overlays, just let stage click advance slide.
  if (sequenceDefs.length === 0) {
    overlayAdvanceHandler = null;
    const stageClickHandler = () => {
      moveToNextSlide();
    };
    stageRoot.addEventListener("click", stageClickHandler);
    registerTeardownHandler(() => {
      stageRoot.removeEventListener("click", stageClickHandler);
    });
    return;
  }

  let currentIndex = 0;
  let currentElement = null;
  let isWaiting = false;
  let showTimerId = null; // pre-show delay timer (non-autoAdvance)
  let autoTimerId = null; // post-show auto-advance timer (autoAdvance)

  const clearTimers = () => {
    if (showTimerId != null) {
      window.clearTimeout(showTimerId);
      showTimerId = null;
    }
    if (autoTimerId != null) {
      window.clearTimeout(autoTimerId);
      autoTimerId = null;
    }
  };

  const showOverlayNow = (index) => {
    if (currentElement && currentElement.parentNode === stageInner) {
      stageInner.removeChild(currentElement);
    }

    if (index < 0 || index >= sequenceDefs.length) {
      currentElement = null;
      return;
    }

    const overlayDefinition = sequenceDefs[index];
    const overlayElement = createOverlayElement(overlayDefinition);

    if (Array.isArray(overlayDefinition.classList)) {
      overlayDefinition.classList.forEach((cls) =>
        overlayElement.classList.add(cls)
      );
    }

    stageInner.appendChild(overlayElement);
    currentElement = overlayElement;
    isWaiting = false;

    // Play any audio tied to this overlay when it becomes visible
    playOverlayAudio(overlayDefinition);

    // If this overlay should auto-advance, schedule it.
    const dwell =
      overlayDefinition &&
      overlayDefinition.autoAdvance === true &&
      typeof overlayDefinition.delay === "number" &&
      overlayDefinition.delay > 0
        ? overlayDefinition.delay
        : 0;

    if (dwell > 0) {
      autoTimerId = window.setTimeout(() => {
        autoTimerId = null;
        advance();
      }, dwell);
    }
  };

  const scheduleOverlay = (index) => {
    clearTimers();

    const def = sequenceDefs[index];
    if (!def) {
      if (currentElement && currentElement.parentNode === stageInner) {
        stageInner.removeChild(currentElement);
      }
      currentElement = null;
      return;
    }

    // autoAdvance overlays appear immediately; delay is used as dwell time.
    if (def.autoAdvance === true) {
      showOverlayNow(index);
      return;
    }

    // Non-autoAdvance: delay is pre-show delay before overlay appears.
    const delay =
      typeof def.delay === "number" && def.delay > 0 ? def.delay : 0;

    if (delay > 0) {
      if (currentElement && currentElement.parentNode === stageInner) {
        stageInner.removeChild(currentElement);
        currentElement = null;
      }
      isWaiting = true;
      showTimerId = window.setTimeout(() => {
        showTimerId = null;
        showOverlayNow(index);
      }, delay);
    } else {
      showOverlayNow(index);
    }
  };

  const advance = () => {
    if (isWaiting) return;

    if (currentIndex < sequenceDefs.length - 1) {
      currentIndex += 1;
      scheduleOverlay(currentIndex);
    } else {
      overlayAdvanceHandler = null;
      goToNextSlideFromUserGesture();
    }
  };

  // Expose to overlay buttons/hotspots with action="next"
  overlayAdvanceHandler = advance;

  // Initial overlay: respect autoAdvance/delay semantics.
  scheduleOverlay(currentIndex);

  // Stage click advances overlays/slide
  const stageClickHandler = () => {
    advance();
  };
  stageRoot.addEventListener("click", stageClickHandler);
  registerTeardownHandler(() => {
    stageRoot.removeEventListener("click", stageClickHandler);
    clearTimers();
    overlayAdvanceHandler = null;
  });
}

/**
 * Renders overlay layers above the base media using the original
 * timed showAt/hideAt behavior. Used for non-sequential slides.
 *
 * @param {HTMLElement} stageInner
 * @param {Array} overlays
 */
function renderOverlays(stageInner, overlays) {
  overlays.forEach((overlayDefinition) => {
    // Sound-only overlays: schedule audio by delay; no DOM.
    if (overlayDefinition && overlayDefinition.type === "sound") {
      scheduleSoundOverlay(overlayDefinition);
      return;
    }

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
        // Play audio when the overlay actually appears
        playOverlayAudio(overlayDefinition);
      }, overlayDefinition.showAt);
      registerTeardownHandler(() => window.clearTimeout(showTimerId));
    } else {
      // No showAt: overlay is visible immediately, so play audio now
      playOverlayAudio(overlayDefinition);
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

  if (overlayDefinition.type === "video") {
    wrapper.style.pointerEvents = "auto";
    wrapper.style.cursor = "pointer";

    const video = document.createElement("video");
    video.className = "overlay-video-inner";
    video.src = overlayDefinition.src || "";
    video.playsInline = true;
    video.loop = !!overlayDefinition.loop;
    video.controls = false;

    if (typeof appState !== "undefined" && "soundEnabled" in appState) {
      video.muted = !appState.soundEnabled;
    }

    video.style.width = "100%";
    video.style.height = "100%";
    video.style.objectFit = "cover";

    activeVideoElements.add(video);
    wrapper.appendChild(video);

    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "overlay-video-play";
    playButton.setAttribute(
      "aria-label",
      overlayDefinition.playLabel || "Play video"
    );
    wrapper.appendChild(playButton);

    const startPlayback = () => {
      if (video.paused) {
        const playPromise = video.play();
        if (playPromise && typeof playPromise.catch === "function") {
          playPromise.catch(() => {});
        }
        playButton.style.display = "none";
      }
    };

    wrapper.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      startPlayback();
    });

    if (overlayDefinition.autoplay) {
      const playPromise = video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }
      playButton.style.display = "none";
    }

    return wrapper;
  }

  return wrapper;
}

/**
 * Wires an interactive overlay action.
 * Clicks on overlays stop propagation to prevent the stage click handler from also firing.
 *
 * Supported actions:
 * - "next": advance overlay sequence if active, otherwise advance slide.
 * - "skip": always advance slide immediately.
 *
 * @param {HTMLElement} element
 * @param {string} action
 */
function wireOverlayAction(element, action) {
  if (action === "skip") {
    const handler = (event) => {
      event.preventDefault();
      event.stopPropagation();
      goToNextSlideFromUserGesture(); // always skip entire slide
    };
    element.addEventListener("click", handler);
    registerTeardownHandler(() =>
      element.removeEventListener("click", handler)
    );
  } else if (action === "next") {
    const handler = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (typeof overlayAdvanceHandler === "function") {
        // In a sequential overlay flow, step overlays instead of immediately changing slide
        overlayAdvanceHandler();
      } else {
        goToNextSlideFromUserGesture();
      }
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

  // Preload overlay images and audio for the next slide as well.
  preloadOverlayImagesForSlide(nextSlide);
  preloadOverlayAudioForSlide(nextSlide);

  const base = nextSlide.base || {};
  if (base.type === "image" && base.src) {
    const img = new Image();
    img.src = base.src;
    registerTeardownHandler(() => {});
  } else if (base.type === "video" && base.src) {
    // Precreate and buffer the real video element for reuse.
    getOrCreatePreloadedVideo(base);
  }
}

/**
 * Preloads all image overlays for a given slide so they
 * are in the browser cache before they are shown.
 *
 * @param {Object} slide
 */
function preloadOverlayImagesForSlide(slide) {
  if (!slide || !Array.isArray(slide.overlays)) return;

  slide.overlays.forEach((overlay) => {
    if (overlay && overlay.type === "image" && overlay.src) {
      const img = new Image();
      img.src = overlay.src;
    }
  });
}

/**
 * Preloads all overlay audio (music + sound) for a given slide so
 * they are ready when overlays appear.
 *
 * @param {Object} slide
 */
function preloadOverlayAudioForSlide(slide) {
  if (!slide || !Array.isArray(slide.overlays)) return;

  slide.overlays.forEach((overlay) => {
    if (!overlay) return;

    // Music overlay entries: { src }
    if (Array.isArray(overlay.music)) {
      overlay.music.forEach((m) => {
        if (m && m.src) {
          getOrCreateMusicAudio(m.src);
        }
      });
    }

    // Sound overlay entries: { src, loops, stopOthers }
    if (Array.isArray(overlay.sound)) {
      overlay.sound.forEach((s) => {
        if (s && s.src) {
          getOrCreateSoundAudio(s.src);
        }
      });
    }
  });
}

/**
 * Plays any music/sound defined on an overlay definition.
 * Uses playMusic / playSound and respects global toggles.
 *
 * Expected overlay shape:
 *   music: [{ src, stopOthers?, loop? }]
 *   sound: [{ src, loops?, stopOthers? }]
 *
 * @param {Object} overlayDefinition
 */
function playOverlayAudio(overlayDefinition) {
  if (!overlayDefinition) return;

  // Music entries
  if (Array.isArray(overlayDefinition.music)) {
    overlayDefinition.music.forEach((m) => {
      if (!m || !m.src) return;
      const audio = getOrCreateMusicAudio(m.src);
      if (!audio) return;
      const options = {
        stopOthers: typeof m.stopOthers === "boolean" ? m.stopOthers : true, // default: stop other music
        loop: typeof m.loop === "boolean" ? m.loop : true, // default: loop music
      };
      playMusic(audio, options);
    });
  }

  // Sound entries
  if (Array.isArray(overlayDefinition.sound)) {
    overlayDefinition.sound.forEach((s) => {
      if (!s || !s.src) return;
      const audio = getOrCreateSoundAudio(s.src);
      if (!audio) return;
      const options = {
        stopOthers: s.stopOthers === true, // default: don't stop others
        loop: s.loops === true, // uses "loops" field per your JSON
      };
      playSound(audio, options);
    });
  }
}

/**
 * Schedules a sound-only overlay to play its audio
 * after an optional delay. No DOM, no click impact.
 *
 * @param {Object} overlayDefinition
 */
function scheduleSoundOverlay(overlayDefinition) {
  if (!overlayDefinition) return;

  const delay =
    typeof overlayDefinition.delay === "number" && overlayDefinition.delay > 0
      ? overlayDefinition.delay
      : 0;

  if (delay > 0) {
    const timerId = window.setTimeout(() => {
      playOverlayAudio(overlayDefinition);
    }, delay);
    registerTeardownHandler(() => window.clearTimeout(timerId));
  } else {
    playOverlayAudio(overlayDefinition);
  }
}

/**
 * Ensures a hidden "pool" element exists to hold preloaded media in the DOM.
 * Keeping elements attached while buffering makes it more likely the browser
 * retains the buffer.
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
    pool.style.pointerEvents = "none";
    pool.setAttribute("aria-hidden", "true");
    document.body.appendChild(pool);
  }
  return pool;
}

/**
 * Create (if needed) and preload a video element
 * for the given base config, parked offscreen.
 *
 * @param {Object} base
 * @returns {HTMLVideoElement|null}
 */
function getOrCreatePreloadedVideo(base) {
  if (!base?.src) return null;

  let video = videoElementCache.get(base.src);
  if (!video) {
    const pool = getOrCreatePreloadPool();

    video = document.createElement("video");
    video.preload = "metadata";
    video.src = base.src;
    video.playsInline = true;
    video.muted = !appState.soundEnabled;
    video.autoplay = false;
    video.controls = base.controls === true;
    video.setAttribute("aria-label", base.caption || "Video");

    // Park it safely offscreen while it buffers.
    video.style.position = "absolute";
    video.style.left = "-9999px";
    video.style.top = "0";
    video.style.width = "1px";
    video.style.height = "1px";
    video.style.opacity = "0";
    video.style.pointerEvents = "none";

    pool.appendChild(video);

    videoElementCache.set(base.src, video);
  }

  // Keep properties up to date per slide use.
  video.muted = !appState.soundEnabled;
  video.controls = base.controls === true;
  video.setAttribute("aria-label", base.caption || "Video");
  if (base.poster) video.poster = base.poster;

  activeVideoElements.add(video);

  return video;
}

/**
 * Preload a video via the shared preloaded-element path.
 * Kept for compatibility with existing calls.
 *
 * @param {string} src
 */
function preloadVideoSource(src) {
  if (!src) return;
  getOrCreatePreloadedVideo({ type: "video", src });
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

    for (const slide of pathDefinition.slides) {
      const base = slide?.base;
      if (base?.type === "video" && base.src) {
        getOrCreatePreloadedVideo(base);
        break;
      }
    }
  });
}

/**
 * Plays a music track if music is enabled.
 * By default stops all other current music first.
 *
 * @param {string|HTMLAudioElement} target  id or <audio> element
 * @param {Object} [options]
 * @param {boolean} [options.stopOthers=true]
 * @param {boolean} [options.loop=true]
 * @param {number} [options.volume=1]
 * @returns {HTMLAudioElement|null}
 */
function playMusic(target, options = {}) {
  if (appState.musicEnabled === false) return null;

  const audio = resolveAudioElement(target);
  if (!audio) return null;

  const { stopOthers = true, loop = true, volume = 1 } = options;

  if (stopOthers) {
    activeMusicElements.forEach((el) => {
      try {
        el.pause();
        el.currentTime = 0;
      } catch {}
    });
    activeMusicElements.clear();
  }

  audio.loop = loop;
  audio.volume = volume;
  audio.muted = false;

  activeMusicElements.add(audio);

  const playPromise = audio.play();
  if (playPromise && typeof playPromise.then === "function") {
    playPromise.catch(() => {
      // Autoplay might be blocked; ignore.
    });
  }

  return audio;
}

/**
 * Pauses music playback without resetting currentTime.
 * If a target is provided, pauses just that; otherwise pauses all music.
 *
 * @param {string|HTMLAudioElement} [target]
 */
function pauseMusic(target) {
  if (!target) {
    // Pause all music, keep their positions
    activeMusicElements.forEach((el) => {
      try {
        el.pause();
      } catch {}
    });
    return;
  }

  const audio = resolveAudioElement(target);
  if (!audio) return;

  try {
    audio.pause();
  } catch {}
}

/**
 * Resumes paused music if any exists.
 * Finds the first paused element in activeMusicElements and plays it.
 *
 * @returns {HTMLAudioElement|null}
 */
function resumeMusic() {
  if (appState.musicEnabled === false) return null;

  let resumed = null;

  activeMusicElements.forEach((el) => {
    if (!resumed && el && el.paused) {
      try {
        const playPromise = el.play();
        if (playPromise && typeof playPromise.then === "function") {
          playPromise.catch(() => {
            // Autoplay might be blocked; ignore.
          });
        }
        resumed = el;
      } catch {
        // Ignore individual playback errors, try others if any.
      }
    }
  });

  return resumed;
}

/**
 * Stops music playback.
 * If a target is provided, stops just that; otherwise stops all music.
 *
 * @param {string|HTMLAudioElement} [target]
 */
function stopMusic(target) {
  if (!target) {
    // Stop all music
    activeMusicElements.forEach((el) => {
      try {
        el.pause();
        el.currentTime = 0;
      } catch {}
    });
    activeMusicElements.clear();
    return;
  }

  const audio = resolveAudioElement(target);
  if (!audio) return;

  try {
    audio.pause();
    audio.currentTime = 0;
  } catch {}

  activeMusicElements.delete(audio);
}

/**
 * Plays a sound effect if sound is enabled.
 * Does NOT stop other sounds by default.
 *
 * @param {string|HTMLAudioElement} target  id or <audio> element
 * @param {Object} [options]
 * @param {boolean} [options.stopOthers=false]
 * @param {boolean} [options.loop=false]
 * @param {number} [options.volume=1]
 * @returns {HTMLAudioElement|null}
 */
function playSound(target, options = {}) {
  if (appState.soundEnabled === false) return null;

  const audio = resolveAudioElement(target);
  if (!audio) return null;

  const { stopOthers = false, loop = false, volume = 1 } = options;

  if (stopOthers) {
    activeSoundElements.forEach((el) => {
      try {
        el.pause();
        el.currentTime = 0;
      } catch {}
    });
    activeSoundElements.clear();
  }

  audio.loop = loop;
  audio.volume = volume;
  audio.muted = false;

  // Restart from beginning by default for SFX
  try {
    audio.currentTime = 0;
  } catch {}

  activeSoundElements.add(audio);

  const playPromise = audio.play();
  if (playPromise && typeof playPromise.then === "function") {
    playPromise
      .then(() => {
        // Remove from active set when it naturally ends (non-looping).
        if (!loop) {
          const onEnded = () => {
            activeSoundElements.delete(audio);
            audio.removeEventListener("ended", onEnded);
          };
          audio.addEventListener("ended", onEnded);
        }
      })
      .catch(() => {
        // Autoplay might be blocked; ignore.
      });
  }

  return audio;
}

/**
 * Pauses sound effects without resetting currentTime.
 * If a target is provided, pauses just that; otherwise pauses all sounds.
 *
 * @param {string|HTMLAudioElement} [target]
 */
function pauseSound(target) {
  if (!target) {
    // Pause all sounds, keep their positions
    activeSoundElements.forEach((el) => {
      try {
        el.pause();
      } catch {}
    });
    return;
  }

  const audio = resolveAudioElement(target);
  if (!audio) return;

  try {
    audio.pause();
  } catch {}
}

/**
 * Resumes paused sound if any exists.
 * Finds the first paused element in activeSoundElements and plays it.
 *
 * @returns {HTMLAudioElement|null}
 */
function resumeSound() {
  if (appState.soundEnabled === false) return null;

  let resumed = null;

  activeSoundElements.forEach((el) => {
    if (!resumed && el && el.paused) {
      try {
        const playPromise = el.play();
        if (playPromise && typeof playPromise.then === "function") {
          playPromise.catch(() => {
            // Autoplay might be blocked; ignore.
          });
        }
        resumed = el;
      } catch {
        // Ignore individual playback errors, try others if any.
      }
    }
  });

  return resumed;
}

/**
 * Stops sound effects.
 * If a target is provided, stops just that; otherwise stops all sounds.
 *
 * @param {string|HTMLAudioElement} [target]
 */
function stopSound(target) {
  if (!target) {
    activeSoundElements.forEach((el) => {
      try {
        el.pause();
        el.currentTime = 0;
      } catch {}
    });
    activeSoundElements.clear();
    return;
  }

  const audio = resolveAudioElement(target);
  if (!audio) return;

  try {
    audio.pause();
    audio.currentTime = 0;
  } catch {}

  activeSoundElements.delete(audio);
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
        goToNextSlideFromUserGesture();
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
