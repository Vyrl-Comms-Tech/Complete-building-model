import { LinearToneMapping, ACESFilmicToneMapping } from 'three';
import { Viewer } from './viewer.js';
import { logParityState } from './debug.js';
import { setupHoverInteraction } from './hoverInteraction.js';
import { environments } from './environments.js';
import { setupEnvironmentSelect } from './environmentSelect.js';

const el = document.getElementById('viewer');

// Finalized camera configuration, dialed in interactively via the (now
// removed) camera debug panel and hard-coded here. See viewer.js
// applyCameraOverride() for exactly what each field does. To retune, restore
// cameraDebugPanel.js (git history) rather than editing these numbers by hand.
const CAMERA_OVERRIDE = {
	position: [13.2606, 13.5978, 0.9805],
	target: [1.0394, 1.3733, 7.8057],
	fov: 57.0,
	near: 3.0292,
	far: 30292.26,
	minPolarAngle: 0.8529,
	maxPolarAngle: 0.8529, // vertical orbit fully locked at this angle
	minAzimuthAngle: -Infinity,
	maxAzimuthAngle: Infinity, // horizontal orbit unrestricted
	minDistance: 0.0,
	maxDistance: 3029.2256,
	enableRotate: true,
	enableZoom: true,
	enablePan: true,
	lockOrigin: true, // controls.target re-asserted every frame at the value above
};

const viewer = new Viewer(el, {
	// cameraPosition: [x, y, z],  // optional: skip auto-framing for a fixed shot
	cameraOverride: CAMERA_OVERRIDE,
});

// --- Load your GLB here -----------------------------------------------------
// Swap this URL for wherever your asset actually lives (public/models/, a CDN,
// an upload flow, etc). load() returns the parsed GLTF result if you need
// gltf.scene / gltf.animations / gltf.cameras directly.
const MODEL_URL = '/models/360 Exterior 1.5.glb';

// Default HDRI once the model has loaded (overrides the parity default of
// 'Neutral' set in viewer.js's constructor) — highest-res, most neutral
// daytime sky of the 6 supplied Poly Haven HDRIs. Background is shown too
// (not lighting-only), per requirements.
const DEFAULT_HDRI_NAME = environments.find((e) => e.id === 'polyhaven-qwantani').name;

viewer
	.load(MODEL_URL)
	.then((gltf) => {
		console.log('[viewer] loaded', MODEL_URL, gltf);

		// Zone hover highlight (Parking / Amenities / Backyard / House).
		// Safe to call even if the loaded GLB doesn't have these nodes —
		// it warns to console and no-ops instead of throwing.
		window.__hoverInteraction = setupHoverInteraction(viewer);

		// HDRI environment + visible background.
		viewer.setBackgroundVisible(true);
		return viewer.setEnvironment(DEFAULT_HDRI_NAME);
	})
	.then(() => {
		setupEnvironmentSelect(viewer, el);
	})
	.catch((err) => {
		console.error('[viewer] failed to load', MODEL_URL, err);
	});

// --- Debug/parity overlay ---------------------------------------------------
// Press "d" to dump the current renderer/camera/scene parity state to the
// console (see debug.js). Not wired into the render loop — traversal cost
// only happens when you actually ask for it.
window.addEventListener('keydown', (e) => {
	if (e.key === 'd') logParityState(viewer);
});

// Expose for manual console inspection during side-by-side comparison against
// gltf-viewer.donmccurdy.com.
window.viewer = viewer;
window.__toneMappingOptions = { LinearToneMapping, ACESFilmicToneMapping };
