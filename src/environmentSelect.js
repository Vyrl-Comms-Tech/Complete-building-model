// Minimal on-page environment switcher — a single native <select>, no styling
// framework, no dat.GUI. Explicitly NOT a clone of the reference viewer's GUI
// (which was intentionally left out of this project); this exists only
// because there are now 8 environment choices (None, Neutral, 2 reference
// EXRs, 6 user-supplied HDRIs) and something on-page needs to switch between
// them without opening devtools.

import { environments } from './environments.js';

/**
 * @param {import('./viewer.js').Viewer} viewer
 * @param {HTMLElement} container - appended as a child, positioned via CSS (.env-select-wrap)
 */
export function setupEnvironmentSelect(viewer, container) {
	const wrap = document.createElement('div');
	wrap.className = 'env-select-wrap';

	const label = document.createElement('label');
	label.textContent = 'Environment';
	label.htmlFor = 'env-select';

	const select = document.createElement('select');
	select.id = 'env-select';

	environments.forEach((env) => {
		const option = document.createElement('option');
		option.value = env.name;
		option.textContent = env.name;
		if (env.name === viewer.state.environment) option.selected = true;
		select.appendChild(option);
	});

	select.addEventListener('change', () => {
		viewer.setEnvironment(select.value);
	});

	wrap.appendChild(label);
	wrap.appendChild(select);
	container.appendChild(wrap);

	return {
		dispose() {
			if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
		},
	};
}
