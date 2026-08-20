// Optional parity debug dump. Call logParityState(viewer) from the browser console
// or a keyboard shortcut — never from inside the render loop (this traverses the
// whole scene graph, which is exactly the kind of per-frame cost the reference
// avoids and we should too).

import { REVISION, Box3, Vector3 } from 'three';

export function logParityState(viewer) {
	const { renderer, defaultCamera, activeCamera, controls, content, state, mixer, clips } = viewer;

	let meshCount = 0;
	const materialSet = new Set();
	const textureSet = new Set();
	const lightNodes = [];

	if (content) {
		content.traverse((node) => {
			if (node.isMesh) {
				meshCount++;
				const mats = Array.isArray(node.material) ? node.material : [node.material];
				mats.forEach((m) => {
					if (!m) return;
					materialSet.add(m);
					for (const key in m) {
						if (m[key] && m[key].isTexture) textureSet.add(m[key]);
					}
				});
			}
			if (node.isLight) lightNodes.push(`${node.type} "${node.name}"`);
		});
	}

	console.table({
		threeRevision: REVISION,
		toneMapping: toneMappingName(renderer.toneMapping),
		toneMappingExposure: renderer.toneMappingExposure,
		exposureEV: state.exposure,
		outputColorSpace: renderer.outputColorSpace,
		pixelRatio: renderer.getPixelRatio(),
		canvasWidth: renderer.domElement.width,
		canvasHeight: renderer.domElement.height,
		antialias: renderer.getContextAttributes?.().antialias,
		shadowMapEnabled: renderer.shadowMap.enabled,
		environment: state.environment,
		backgroundIsEnvMap: state.background,
		backgroundColor: state.bgColor,
		cameraType: activeCamera.type,
		cameraFov: activeCamera.isPerspectiveCamera ? activeCamera.fov : 'n/a (ortho)',
		cameraNear: activeCamera.near,
		cameraFar: activeCamera.far,
		cameraIsDefault: activeCamera === defaultCamera,
		controlsTarget: controls.target.toArray().map((n) => +n.toFixed(4)),
		controlsMaxDistance: controls.maxDistance,
		screenSpacePanning: controls.screenSpacePanning,
		punctualLightsFromModel: !state.punctualLights,
		viewerAddedLights: viewer.lights.length,
		meshCount,
		materialCount: materialSet.size,
		textureCount: textureSet.size,
		animationClipCount: clips.length,
		mixerActive: !!mixer,
	});

	if (content) {
		const box = new Box3().setFromObject(content);
		const size = box.getSize(new Vector3());
		const center = box.getCenter(new Vector3());
		console.log('[parity] bounding box size (post-recenter):', size.toArray());
		console.log('[parity] bounding box center (post-recenter, should be ~0,0,0):', center.toArray());
		console.log('[parity] camera position:', defaultCamera.position.toArray());
	}

	console.log('[parity] detected lights on model:', lightNodes.length ? lightNodes : '(none)');
}

function toneMappingName(value) {
	// Matches THREE constant values as of r176; kept local so this file has zero
	// runtime dependency beyond REVISION.
	const names = {
		0: 'NoToneMapping',
		1: 'LinearToneMapping',
		2: 'ReinhardToneMapping',
		3: 'CineonToneMapping',
		4: 'ACESFilmicToneMapping',
		5: 'CustomToneMapping',
		6: 'AgXToneMapping',
		7: 'NeutralToneMapping',
	};
	return names[value] ?? `Unknown(${value})`;
}
