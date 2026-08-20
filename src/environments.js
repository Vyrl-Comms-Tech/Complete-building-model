// Base structure ported from:
// https://github.com/donmccurdy/three-gltf-viewer/blob/main/src/environments.js
//
// 'neutral' has path: null because it is generated procedurally via
// THREE.RoomEnvironment + PMREMGenerator in viewer.js — it is NOT an HDR/EXR file.
//
// 'venice-sunset' and 'footprint-court' point at Don McCurdy's own EXR files,
// rehosted locally under /public/environments/ (see README "Required Assets")
// — not present in this project yet; add the two .exr files there if you want
// those two options to work. format: '.exr' -> loaded via EXRLoader.
//
// The six 'polyhaven-*' entries are custom additions (not from the reference
// app) — user-supplied Poly Haven sky HDRs, format: '.hdr' -> loaded via
// RGBELoader (the correct decoder for Radiance .hdr; EXRLoader only reads
// OpenEXR). See viewer.js getCubeMapTexture() for the loader dispatch by
// `format`.

export const environments = [
	{
		id: '',
		name: 'None',
		path: null,
	},
	{
		id: 'neutral', // THREE.RoomEnvironment
		name: 'Neutral',
		path: null,
	},
	{
		id: 'venice-sunset',
		name: 'Venice Sunset',
		path: '/environments/venice_sunset_1k.exr',
		format: '.exr',
	},
	{
		id: 'footprint-court',
		name: 'Footprint Court (HDR Labs)',
		path: '/environments/footprint_court_2k.exr',
		format: '.exr',
	},
	{
		id: 'polyhaven-aristea-wreck',
		name: 'Aristea Wreck (Poly Haven)',
		path: '/environments/aristea_wreck_puresky_1k.hdr',
		format: '.hdr',
	},
	{
		id: 'polyhaven-furry-clouds',
		name: 'Furry Clouds (Poly Haven)',
		path: '/environments/furry_clouds_1k.hdr',
		format: '.hdr',
	},
	{
		id: 'polyhaven-kloppenheim-06',
		name: 'Kloppenheim 06 (Poly Haven)',
		path: '/environments/kloppenheim_06_puresky_2k.hdr',
		format: '.hdr',
	},
	{
		id: 'polyhaven-qwantani',
		name: 'Qwantani (Poly Haven)',
		path: '/environments/qwantani_puresky_2k.hdr',
		format: '.hdr',
	},
	{
		id: 'polyhaven-rosendal-plains',
		name: 'Rosendal Plains (Poly Haven)',
		path: '/environments/rosendal_plains_1k.hdr',
		format: '.hdr',
	},
	{
		id: 'polyhaven-rustig-koppie',
		name: 'Rustig Koppie (Poly Haven)',
		path: '/environments/rustig_koppie_puresky_1k.hdr',
		format: '.hdr',
	},
];
