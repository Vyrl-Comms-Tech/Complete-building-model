// Hover-highlight interaction for named "zone" meshes inside Villa.glb
// (Parking / Ammenities / Backyard / House — see console table on load if the
// exact node names ever change; these are matched case-sensitively below).
//
// The four zone meshes are plain gray overlay boxes authored directly in the
// GLB, sitting over the corresponding section of the house. They are NOT part
// of the visible architecture, so:
//   - fully transparent (opacity 0) by default, but visible=true at all times
//   - on hover: fades to a translucent golden fill (house geometry still
//     visible through it) with a solid golden edge outline, + a small
//     floating text label near the cursor
//   - on hover-out: fades back to fully transparent
//
// Opacity is smoothed (exponential decay toward a target, frame-rate
// independent) rather than snapped instantly. This matters because raycasting
// on pointermove can flip hit/no-hit rapidly — right at a box edge, or when
// the cursor crosses between two adjacent zones — several times within a
// couple of frames. Toggling `.visible` or opacity instantly on every one of
// those flips is what reads as "glittering"/flickering during fast mouse
// movement. Smoothing the opacity turns that rapid on/off into a fade, so a
// single-frame flicker in the raycast result no longer produces a visible
// flash, while a deliberate, sustained hover still reaches full opacity
// quickly (a few frames).
//
// This is intentionally kept separate from viewer.js, which is a straight,
// parity-critical port of the reference renderer — none of this hover logic
// exists in gltf-viewer.donmccurdy.com, so it stays out of that file entirely
// (aside from the generic, no-op-by-default addBeforeRenderCallback hook) and
// never touches any authored villa material.

import {
	Color,
	EdgesGeometry,
	LineBasicMaterial,
	LineSegments,
	MeshBasicMaterial,
	Raycaster,
	Vector2,
} from 'three';

// Raw glTF node names, confirmed by inspecting Villa.glb directly (not guessed).
// Note "Ammenities" is the actual spelling authored in the file (two m's).
const ZONE_NODE_NAMES = ['Parking', 'Ammenities', 'Backyard', 'House'];

// Display labels shown in the tooltip — normalized spelling/casing for the UI
// even though the underlying node name keeps the authored spelling.
const ZONE_LABELS = {
	Parking: 'Parking',
	Ammenities: 'Amenities',
	Backyard: 'Backyard',
	House: 'House',
};

const HOVER_COLOR = new Color(0xffc72c); // golden
const HOVER_OPACITY = 0.35; // fill opacity when fully hovered
const BORDER_COLOR = new Color(0xffc72c); // same golden, solid line
const BORDER_OPACITY = 0.9; // border opacity when fully hovered

// Exponential smoothing rate: higher = snappier, lower = softer/slower fade.
// Framed as a "reach ~63% of the way to target per this many seconds" time
// constant so it stays correct regardless of frame rate (see tick()).
const FADE_TIME_CONSTANT = 0.08; // seconds

/**
 * Wires hover highlighting onto the four zone meshes found under `root`.
 * Call once, after the model has finished loading (i.e. inside/after
 * viewer.load(...).then(...)).
 *
 * @param {import('./viewer.js').Viewer} viewer
 * @returns {{ dispose(): void }} call dispose() to remove listeners/DOM/materials/frame-callback
 */
export function setupHoverInteraction(viewer) {
	const { scene, renderer, el } = viewer;

	// Find the zone meshes by name. Each may be a single Mesh node, or (per the
	// glTF export) a node with its own mesh — either way node.isMesh is true here.
	const zoneMeshes = [];
	scene.traverse((node) => {
		if (node.isMesh && ZONE_NODE_NAMES.includes(node.name)) {
			zoneMeshes.push(node);
		}
	});

	if (zoneMeshes.length === 0) {
		console.warn(
			'[hover] none of the expected zone meshes were found in the scene:',
			ZONE_NODE_NAMES,
		);
		return { dispose() {} };
	}
	if (zoneMeshes.length < ZONE_NODE_NAMES.length) {
		const found = zoneMeshes.map((m) => m.name);
		console.warn(
			'[hover] some zone meshes were not found. expected:',
			ZONE_NODE_NAMES,
			'found:',
			found,
		);
	}

	// Give each zone its own hover material instance (don't share one material
	// across meshes — keeps future per-zone tweaks possible, and dispose() clean).
	const originalMaterials = new Map(); // mesh -> original material
	const hoverMaterials = new Map(); // mesh -> hover fill material
	const edgeHelpers = new Map(); // mesh -> LineSegments border, parented to mesh
	const currentOpacity = new Map(); // mesh -> current smoothed 0..1 blend
	const targetOpacity = new Map(); // mesh -> target 0..1 blend (1 = hovered)

	zoneMeshes.forEach((mesh) => {
		originalMaterials.set(mesh, mesh.material);

		const hoverMaterial = new MeshBasicMaterial({
			color: HOVER_COLOR,
			transparent: true,
			opacity: 0,
			depthWrite: false, // avoid z-fighting/occlusion artifacts on a thin overlay box
		});
		hoverMaterials.set(mesh, hoverMaterial);

		// Solid border outline traced from the box's own edges. Parented to the
		// mesh so it inherits the same transform automatically; its opacity is
		// smoothed in lockstep with the fill in tick().
		const edges = new LineSegments(
			new EdgesGeometry(mesh.geometry),
			new LineBasicMaterial({ color: BORDER_COLOR, transparent: true, opacity: 0 }),
		);
		mesh.add(edges);
		edgeHelpers.set(mesh, edges);

		// Both the fill and the mesh itself stay visible=true permanently — only
		// opacity changes. Flipping `.visible` is an instant, non-interpolatable
		// cut, which is part of what caused the flicker; opacity fades smoothly.
		mesh.material = hoverMaterial;
		mesh.visible = true;

		currentOpacity.set(mesh, 0);
		targetOpacity.set(mesh, 0);
	});

	// --- Tooltip DOM -----------------------------------------------------------
	const tooltip = document.createElement('div');
	tooltip.className = 'hover-tooltip';
	tooltip.style.opacity = '0';
	el.appendChild(tooltip);

	// --- Raycasting --------------------------------------------------------
	const raycaster = new Raycaster();
	const pointerNDC = new Vector2();
	let hoveredMesh = null; // last raycast hit (can flicker frame to frame)

	function setHoveredMesh(mesh) {
		if (hoveredMesh === mesh) return;

		if (hoveredMesh) targetOpacity.set(hoveredMesh, 0);
		hoveredMesh = mesh;

		if (hoveredMesh) {
			targetOpacity.set(hoveredMesh, 1);
			tooltip.textContent = ZONE_LABELS[hoveredMesh.name] || hoveredMesh.name;
		}
	}

	function positionTooltip(clientX, clientY) {
		const rect = el.getBoundingClientRect();
		tooltip.style.left = `${clientX - rect.left + 14}px`;
		tooltip.style.top = `${clientY - rect.top + 14}px`;
	}

	function onPointerMove(event) {
		const rect = el.getBoundingClientRect();
		pointerNDC.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		pointerNDC.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

		raycaster.setFromCamera(pointerNDC, viewer.activeCamera);

		// Only test against the zone meshes, not the whole scene graph — cheap,
		// and avoids the always-visible-but-transparent zone boxes' bounding
		// volumes interfering with picking anything else.
		const intersects = raycaster.intersectObjects(zoneMeshes, false);

		if (intersects.length > 0) {
			setHoveredMesh(intersects[0].object);
			positionTooltip(event.clientX, event.clientY);
		} else {
			setHoveredMesh(null);
		}
	}

	function onPointerLeave() {
		setHoveredMesh(null);
	}

	renderer.domElement.addEventListener('pointermove', onPointerMove);
	renderer.domElement.addEventListener('pointerleave', onPointerLeave);

	// --- Per-frame smoothing ----------------------------------------------
	// Exponential decay toward target, framed as a time constant so the fade
	// speed is identical regardless of monitor refresh rate / frame time.
	function tick(dt) {
		// Guard against a huge dt (e.g. tab was backgrounded) producing a
		// one-frame snap that looks like another glitch.
		const clampedDt = Math.min(dt, 1 / 15);
		const blend = 1 - Math.exp(-clampedDt / FADE_TIME_CONSTANT);

		zoneMeshes.forEach((mesh) => {
			const current = currentOpacity.get(mesh);
			const target = targetOpacity.get(mesh);
			if (current === 0 && target === 0) return;

			const next = current + (target - current) * blend;
			const settled = Math.abs(next - target) < 0.001 ? target : next;
			currentOpacity.set(mesh, settled);

			hoverMaterials.get(mesh).opacity = settled * HOVER_OPACITY;
			edgeHelpers.get(mesh).material.opacity = settled * BORDER_OPACITY;
		});

		// Tooltip opacity mirrors the hovered mesh's own smoothed blend (0..1),
		// so it fades in/out in lockstep with the box highlight instead of
		// snapping — text content already swapped instantly in setHoveredMesh().
		const tooltipTarget = hoveredMesh ? currentOpacity.get(hoveredMesh) : 0;
		tooltip.style.opacity = String(tooltipTarget);
	}

	const unsubscribe = viewer.addBeforeRenderCallback(tick);

	return {
		dispose() {
			unsubscribe();

			renderer.domElement.removeEventListener('pointermove', onPointerMove);
			renderer.domElement.removeEventListener('pointerleave', onPointerLeave);

			zoneMeshes.forEach((mesh) => {
				mesh.material = originalMaterials.get(mesh);

				const edges = edgeHelpers.get(mesh);
				mesh.remove(edges);
				edges.geometry.dispose();
				edges.material.dispose();
			});
			hoverMaterials.forEach((mat) => mat.dispose());

			if (tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);
		},
	};
}
