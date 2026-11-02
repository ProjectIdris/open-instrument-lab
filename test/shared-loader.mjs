// SPDX-License-Identifier: GPL-3.0-only
// Lets Node load the page's own modules: in the browser '/shared/x' is served from engines/, here it is read from there.
export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('/shared/')) return nextResolve(new URL(`../engines/${specifier.slice('/shared/'.length)}`, import.meta.url).href, context);
  return nextResolve(specifier, context);
}
