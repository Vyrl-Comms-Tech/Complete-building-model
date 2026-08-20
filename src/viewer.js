// Rendering pipeline ported for pixel parity with:
// https://github.com/donmccurdy/three-gltf-viewer/blob/main/src/viewer.js  (three@0.176.0)
//
// Every value marked "REFERENCE:" below is copied verbatim from that source, not guessed.
// UI chrome (dat.GUI, Stats panel, AxesHelper corner widget, drag-and-drop) is intentionally
// omitted — none of it affects the rendered image. Everything that DOES affect the rendered
// image (renderer config, PMREM/environment, lights, camera framing, tone mapping, color
// space, loader configuration, animation timing) is reproduced exactly.

import {
	AmbientLight,
	AnimationMixer,
	Box3,
	Cache,
	Color,
	DirectionalLight,
	LoaderUtils,
	LoadingManager,
	PMREMGenerator,
	PerspectiveCamera,
	REVISION,
	Scene,
	Vector3,
	WebGLRenderer,
	LinearToneMapping,
	ACESFilmicToneMapping,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
// RGBELoader is NOT part of the reference viewer (which only ever loads .exr
// environments) — added here to support user-supplied Radiance .hdr files.
// EXRLoader cannot read .hdr (different container format), so this is a real
// loader-format dispatch, not a stylistic swap. See environments.js.
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

import { environments } from './environments.js';

// Exported so a debug overlay (or console) can reference the same enum values
// the reference GUI exposes ("Linear" / "ACES Filmic").
export const ToneMapping = { LinearToneMapping, ACESFilmicToneMapping };

const DEFAULT_CAMERA = '[default]';

// REFERENCE: single shared LoadingManager + DRACO/KTX2 decoder instances, created once
// at module scope (not per-load), matching viewer.js exactly.
const MANAGER = new LoadingManager();
const THREE_PATH = `https://unpkg.com/three@0.${REVISION}.x`;
const DRACO_LOADER = new DRACOLoader(MANAGER).setDecoderPath(
	`${THREE_PATH}/examples/jsm/libs/draco/gltf/`,
);
const KTX2_LOADER = new KTX2Loader(MANAGER).setTranscoderPath(
	`${THREE_PATH}/examples/jsm/libs/basis/`,
);

Cache.enabled = true;

/**
 * Standalone, framework-agnostic GLB/glTF viewer reproducing the rendering
 * pipeline of https://gltf-viewer.donmccurdy.com/ (three-gltf-viewer).
 *
 * Usage:
 *   const viewer = new Viewer(containerEl);
 *   await viewer.load(url);
 */
export class Viewer {
	/**
	 * @param {HTMLElement} el - Container element. The canvas fills it.
	 * @param {object} [options]
	 * @param {[number, number, number]} [options.cameraPosition] - Force an initial
	 *   camera position instead of the auto-framed one (REFERENCE: options.cameraPosition).
	 */
	constructor(el, options = {}) {
		this.el = el;
		this.options = options;

		this.lights = [];
		this.content = null;
		this.mixer = null;
		this.clips = [];

		// REFERENCE: exact default state object from viewer.js's constructor.
		this.state = {
			environment: environments[1].name, // 'Neutral'
			background: false,
			playbackSpeed: 1.0,
			camera: DEFAULT_CAMERA,

			punctualLights: true,
			exposure: 0.0,
			toneMapping: LinearToneMapping,
			ambientIntensity: 0.3,
			ambientColor: '#FFFFFF',
			directIntensity: 0.8 * Math.PI, // REFERENCE: viewer.js TODO(#116), kept as-is
			directColor: '#FFFFFF',
			bgColor: '#191919',
		};

		this.prevTime = 0;

		// REFERENCE: new Color(state.bgColor), assigned to scene.background.
		this.backgroundColor = new Color(this.state.bgColor);

		this.scene = new Scene();
		this.scene.background = this.backgroundColor;

		// REFERENCE: fov 60, near 0.01, far 1000 (far/near are overwritten per-model in setContent).
		const fov = 60;
		const aspect = el.clientWidth / el.clientHeight;
		this.defaultCamera = new PerspectiveCamera(fov, aspect, 0.01, 1000);
		this.activeCamera = this.defaultCamera;
		this.scene.add(this.defaultCamera);

		// REFERENCE: WebGLRenderer({ antialias: true }); no alpha, no other flags —
		// Three.js r176 defaults apply to everything not listed here (including
		// renderer.outputColorSpace = SRGBColorSpace, the r152+ default).
		this.renderer = new WebGLRenderer({ antialias: true });
		this.renderer.setClearColor(0xcccccc); // dead code in practice: scene.background always wins
		this.renderer.setPixelRatio(window.devicePixelRatio);
		this.renderer.setSize(el.clientWidth, el.clientHeight);
		// renderer.shadowMap is never touched -> shadows stay OFF (r176 default).

		// REFERENCE: PMREMGenerator created once, RoomEnvironment baked once at
		// startup and reused — never regenerated per frame or per model load.
		this.pmremGenerator = new PMREMGenerator(this.renderer);
		this.pmremGenerator.compileEquirectangularShader();
		this.neutralEnvironment = this.pmremGenerator.fromScene(new RoomEnvironment()).texture;

		// REFERENCE: screenSpacePanning = true; no damping enabled anywhere.
		this.controls = new OrbitControls(this.defaultCamera, this.renderer.domElement);
		this.controls.screenSpacePanning = true;

		this.el.appendChild(this.renderer.domElement);

		this._resizeHandler = this.resize.bind(this);
		window.addEventListener('resize', this._resizeHandler, false);

		this.animate = this.animate.bind(this);
		requestAnimationFrame(this.animate);
	}

	// REFERENCE render loop: rAF -> controls.update() -> mixer.update(dt) -> render().
	// dt is real elapsed seconds from the rAF timestamp (not frame-rate dependent).
	//
	// _onBeforeRender is NOT part of the reference — it's an empty-by-default
	// hook array so add-on modules (e.g. hoverInteraction.js) can tick per-frame
	// animation (smoothed opacity, etc.) without editing this file or duplicating
	// a second requestAnimationFrame loop. Reference behavior is unchanged when
	// no callbacks are registered.
	animate(time) {
		if (this._disposed) return;
		requestAnimationFrame(this.animate);

		const dt = (time - this.prevTime) / 1000;

		this.controls.update();
		if (this.mixer) this.mixer.update(dt);
		if (this._onBeforeRender) {
			for (const cb of this._onBeforeRender) cb(dt);
		}
		this.render();

		this.prevTime = time;
	}

	/**
	 * Registers a per-frame callback, invoked as cb(dt) just before each render
	 * (dt = real elapsed seconds since the previous frame). Not part of the
	 * reference viewer — an extension point for add-on modules only.
	 * @param {(dt: number) => void} cb
	 * @returns {() => void} unsubscribe function
	 */
	addBeforeRenderCallback(cb) {
		if (!this._onBeforeRender) this._onBeforeRender = [];
		this._onBeforeRender.push(cb);
		return () => {
			const i = this._onBeforeRender.indexOf(cb);
			if (i !== -1) this._onBeforeRender.splice(i, 1);
		};
	}

	render() {
		this.renderer.render(this.scene, this.activeCamera);
	}

	resize() {
		const { clientHeight, clientWidth } = this.el;

		this.defaultCamera.aspect = clientWidth / clientHeight;
		this.defaultCamera.updateProjectionMatrix();
		this.renderer.setSize(clientWidth, clientHeight);
	}

	/**
	 * Loads a GLB/glTF from a URL.
	 * @param {string} url
	 * @param {string} [rootPath] - Base path for relative asset resolution (external .gltf + .bin/.jpg).
	 * @returns {Promise<import('three/addons/loaders/GLTFLoader.js').GLTF>}
	 */
	load(url, rootPath = LoaderUtils.extractUrlBase(url)) {
		return new Promise((resolve, reject) => {
			// REFERENCE: GLTFLoader wired to the shared DRACO/KTX2/Meshopt pipeline,
			// with KTX2 support detection run against THIS renderer instance.
			const loader = new GLTFLoader(MANAGER)
				.setCrossOrigin('anonymous')
				.setDRACOLoader(DRACO_LOADER)
				.setKTX2Loader(KTX2_LOADER.detectSupport(this.renderer))
				.setMeshoptDecoder(MeshoptDecoder);

			loader.load(
				url,
				(gltf) => {
					const scene = gltf.scene || gltf.scenes[0];
					const clips = gltf.animations || [];

					if (!scene) {
						reject(
							new Error(
								'This model contains no scene, and cannot be viewed here. However,' +
									' it may contain individual 3D resources.',
							),
						);
						return;
					}

					this.setContent(scene, clips);
					resolve(gltf);
				},
				undefined,
				reject,
			);
		});
	}

	/**
	 * @param {import('three').Object3D} object
	 * @param {import('three').AnimationClip[]} clips
	 */
	setContent(object, clips) {
		this.clear();

		// REFERENCE: donmccurdy/three-gltf-viewer#330 — matrices must be current
		// before computing world-space bounds, or the box can be stale/wrong.
		object.updateMatrixWorld();

		const box = new Box3().setFromObject(object);
		const size = box.getSize(new Vector3()).length();
		const center = box.getCenter(new Vector3());

		this.controls.reset();

		// REFERENCE: re-center the model itself at the origin (not the camera target).
		object.position.x -= center.x;
		object.position.y -= center.y;
		object.position.z -= center.z;

		// REFERENCE: clipping planes and orbit distance are derived from model scale,
		// not fixed constants — this is what makes framing correct across wildly
		// different model scales (millimeters to buildings).
		this.controls.maxDistance = size * 10;

		this.defaultCamera.near = size / 100;
		this.defaultCamera.far = size * 100;
		this.defaultCamera.updateProjectionMatrix();

		if (this.options.cameraPosition) {
			this.defaultCamera.position.fromArray(this.options.cameraPosition);
			this.defaultCamera.lookAt(new Vector3());
		} else {
			// REFERENCE framing formula, reproduced exactly. Because the object was
			// just re-centered to the origin, "center" here is used only to derive
			// the camera OFFSET, and lookAt(center) still resolves correctly since
			// the object's own new local origin coincides with world (0,0,0).
			this.defaultCamera.position.copy(center);
			this.defaultCamera.position.x += size / 2.0;
			this.defaultCamera.position.y += size / 5.0;
			this.defaultCamera.position.z += size / 2.0;
			this.defaultCamera.lookAt(center);
		}

		this.setCamera(DEFAULT_CAMERA);
		this.controls.saveState();

		this.scene.add(object);
		this.content = object;

		// REFERENCE: if the GLB carries its own punctual lights (KHR_lights_punctual),
		// the viewer's own ambient+directional lights are never added at all —
		// no double-lighting.
		this.state.punctualLights = true;
		this.content.traverse((node) => {
			if (node.isLight) this.state.punctualLights = false;
		});

		this.setClips(clips);

		this.updateLights();
		this.updateEnvironment();
	}

	/** @param {import('three').AnimationClip[]} clips */
	setClips(clips) {
		if (this.mixer) {
			this.mixer.stopAllAction();
			this.mixer.uncacheRoot(this.mixer.getRoot());
			this.mixer = null;
		}

		this.clips = clips;
		if (!clips.length) return;

		this.mixer = new AnimationMixer(this.content);

		// REFERENCE: only the FIRST clip autoplays; additional clips are loaded but
		// left stopped (the reference GUI lets you toggle them individually).
		const action = this.mixer.clipAction(clips[0]);
		action.play();
	}

	/** @param {string} name - Node name of a camera embedded in the glTF, or DEFAULT_CAMERA. */
	setCamera(name) {
		if (name === DEFAULT_CAMERA) {
			this.controls.enabled = true;
			this.activeCamera = this.defaultCamera;
		} else {
			this.controls.enabled = false;
			this.content.traverse((node) => {
				if (node.isCamera && node.name === name) this.activeCamera = node;
			});
		}
	}

	updateLights() {
		const state = this.state;
		const lights = this.lights;

		if (state.punctualLights && !lights.length) {
			this.addLights();
		} else if (!state.punctualLights && lights.length) {
			this.removeLights();
		}

		// REFERENCE: exposure is EV-style, exposure = 2^state.exposure. Default
		// state.exposure = 0 -> toneMappingExposure = 1.0. Do not hardcode 1.0
		// directly; keep the formula so a future exposure control stays correct.
		this.renderer.toneMapping = Number(state.toneMapping);
		this.renderer.toneMappingExposure = Math.pow(2, state.exposure);

		if (lights.length === 2) {
			lights[0].intensity = state.ambientIntensity;
			lights[0].color.set(state.ambientColor);
			lights[1].intensity = state.directIntensity;
			lights[1].color.set(state.directColor);
		}
	}

	addLights() {
		const state = this.state;

		// REFERENCE: both lights are parented to the CAMERA, not the scene root.
		// This means the directional light's direction is always relative to the
		// current view orientation — it rotates together with the camera as the
		// user orbits. Parenting it to the scene instead is a real parity bug.
		const light1 = new AmbientLight(state.ambientColor, state.ambientIntensity);
		light1.name = 'ambient_light';
		this.defaultCamera.add(light1);

		const light2 = new DirectionalLight(state.directColor, state.directIntensity);
		light2.position.set(0.5, 0, 0.866); // REFERENCE: ~60º
		light2.name = 'main_light';
		this.defaultCamera.add(light2);

		this.lights.push(light1, light2);
	}

	removeLights() {
		this.lights.forEach((light) => light.parent.remove(light));
		this.lights.length = 0;
	}

	updateEnvironment() {
		const environment = environments.filter((entry) => entry.name === this.state.environment)[0];

		return this.getCubeMapTexture(environment).then(({ envMap }) => {
			this.scene.environment = envMap;
			this.scene.background = this.state.background ? envMap : this.backgroundColor;
		});
	}

	getCubeMapTexture(environment) {
		const { id, path, format } = environment;

		// REFERENCE: 'neutral' reuses the RoomEnvironment PMREM baked once at
		// construction time — it is not regenerated on every environment switch.
		if (id === 'neutral') {
			return Promise.resolve({ envMap: this.neutralEnvironment });
		}

		if (id === '') {
			return Promise.resolve({ envMap: null });
		}

		// REFERENCE only ever loads .exr (via EXRLoader). Radiance .hdr is a
		// different container format that EXRLoader cannot parse — this format
		// dispatch is a deliberate, non-reference addition to support
		// user-supplied .hdr environments (see environments.js). Both loaders
		// decode to the same in-memory float/half-float equirect texture shape,
		// so the PMREM step below (fromEquirectangular) is identical either way.
		const Loader = format === '.hdr' ? RGBELoader : EXRLoader;

		return new Promise((resolve, reject) => {
			new Loader().load(
				path,
				(texture) => {
					const envMap = this.pmremGenerator.fromEquirectangular(texture).texture;
					texture.dispose();
					resolve({ envMap });
				},
				undefined,
				reject,
			);
		});
	}

	/** Sets the background swatch color and re-applies it if the background is not an env map. */
	updateBackground(hexColor) {
		this.state.bgColor = hexColor;
		this.backgroundColor.set(hexColor);
	}

	/** Toggles whether scene.background shows the environment map or the flat backgroundColor. */
	setBackgroundVisible(showEnvironment) {
		this.state.background = showEnvironment;
		return this.updateEnvironment();
	}

	/**
	 * Switches the active IBL environment by display name (see environments.js),
	 * e.g. 'None' | 'Neutral' | 'Venice Sunset' | 'Footprint Court (HDR Labs)'.
	 */
	setEnvironment(name) {
		this.state.environment = name;
		return this.updateEnvironment();
	}

	/** @param {number} toneMapping - THREE.LinearToneMapping | THREE.ACESFilmicToneMapping | ... */
	setToneMapping(toneMapping) {
		this.state.toneMapping = toneMapping;
		this.updateLights();
	}

	/** @param {number} exposure - EV stops; renderer exposure = 2^exposure (REFERENCE formula). */
	setExposure(exposure) {
		this.state.exposure = exposure;
		this.updateLights();
	}

	clear() {
		if (!this.content) return;

		this.scene.remove(this.content);

		this.content.traverse((node) => {
			if (node.geometry) node.geometry.dispose();
		});

		// REFERENCE disposes textures only (loop below). We additionally dispose
		// the material itself — a deliberate deviation, not in viewer.js. The
		// reference never calls clear() more than once per page (only on new
		// drag-and-drop loads, immediately followed by a fresh material set from
		// GLTFLoader), so a leaked material there is negligible. In a long-lived
		// SPA that repeatedly swaps models, skipping this leaks a Material (and
		// its compiled WebGL program) per reload. Does not change rendered pixels.
		traverseMaterials(this.content, (material) => {
			for (const key in material) {
				if (key !== 'envMap' && material[key] && material[key].isTexture) {
					material[key].dispose();
				}
			}
			material.dispose();
		});
	}

	/** Full teardown: stops the render loop, removes listeners, frees GPU resources. */
	dispose() {
		window.removeEventListener('resize', this._resizeHandler);
		this._disposed = true;

		this.clear();

		if (this.neutralEnvironment) this.neutralEnvironment.dispose();
		this.pmremGenerator.dispose();

		this.controls.dispose();
		this.renderer.dispose();

		if (this.renderer.domElement.parentNode === this.el) {
			this.el.removeChild(this.renderer.domElement);
		}
	}
}

function traverseMaterials(object, callback) {
	object.traverse((node) => {
		if (!node.geometry) return;
		const materials = Array.isArray(node.material) ? node.material : [node.material];
		materials.forEach(callback);
	});
}
