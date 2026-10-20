// dsh-ha-core — host half.
//
// The shared layer is CLIENT-side (toast/i18n/Markdown/settings/menu bridge/DOM helpers), so
// this half exists only so the loader can activate the package. Keeping it empty is what makes
// the package safe to add: there is no host behaviour to get wrong yet.
function apply() {}
export { apply };
export const name = 'dsh-ha-core';
