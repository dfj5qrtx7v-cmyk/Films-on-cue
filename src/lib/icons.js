import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Brand marks from Simple Icons (CC0), used only to link to the owner's profiles.
const brands = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'brand-icons.json'), 'utf8'));

// Interface icons, drawn on a 24px grid with 1.75px strokes.
const ui = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  external: '<path d="M14 5h5v5M19 5l-8 8M18 14v5H5V6h5"/>',
  mail: '<path d="M3.5 6h17v12h-17z"/><path d="M4 6.5l8 6.5 8-6.5"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z"/>',
  pin: '<path d="M9 4h6l-1 6 3.5 3.5h-11L10 10z"/><path d="M12 13.5V20"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  logout: '<path d="M14 4H5v16h9M10 12h10M16.5 8.5L20 12l-3.5 3.5"/>',
};

export function icon(name, { size = 20, label } = {}) {
  const a11y = label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"';
  if (brands[name]) {
    return `<svg class="icon icon-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" ${a11y}><path d="${brands[name].path}"/></svg>`;
  }
  const body = ui[name] || '';
  return `<svg class="icon icon-${name}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="square" ${a11y}>${body}</svg>`;
}
