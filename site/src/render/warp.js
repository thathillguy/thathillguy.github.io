// Bends the page's text with the same field the canvas lens uses: an SVG displacement-map filter
// whose map is a small image of the deflection, moved under the pointer. Browsers without SVG
// filters on HTML elements just leave the text where it is.
const SVG = 'http://www.w3.org/2000/svg';
const XLINK = 'http://www.w3.org/1999/xlink';

/** Softened thin-lens deflection (pixels) at distance r from the hole, windowed to zero at rMax. */
export function deflection(r, rE, rc, rMax) {
  const t = Math.min(Math.max((r - 0.55 * rMax) / (0.45 * rMax), 0), 1);
  const window = 1 - t * t * (3 - 2 * t);
  return rE * rE * r / (r * r + rc * rc) * window;
}

export function createTextWarp(target) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.position = 'absolute';
  svg.innerHTML = `<filter id="page-warp" x="-20%" y="-150%" width="140%" height="400%" color-interpolation-filters="sRGB" primitiveUnits="userSpaceOnUse">
    <feFlood flood-color="rgb(128,128,128)" result="flat"/>
    <feImage x="0" y="0" width="1" height="1" result="bump"/>
    <feMerge result="map"><feMergeNode in="flat"/><feMergeNode in="bump"/></feMerge>
    <feDisplacementMap in="SourceGraphic" in2="map" scale="0" xChannelSelector="R" yChannelSelector="G"/>
  </filter>`;
  document.body.appendChild(svg);
  const image = svg.querySelector('feImage');
  const disp = svg.querySelector('feDisplacementMap');
  let rMax = 0, dMax = 1, on = false;

  return {
    /** Rebuild the map for an Einstein radius rE (CSS px) at the given device pixel ratio. */
    resize(rE, dpr = 1) {
      const rc = 0.45 * rE;
      rMax = 3.2 * rE;
      dMax = rE * rE / (2 * rc); // the largest deflection, at r = rc
      const size = Math.ceil(2 * rMax), px = Math.ceil(size * dpr);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = px;
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(px, px), d = img.data;
      for (let j = 0; j < px; j++) {
        for (let i = 0; i < px; i++) {
          const x = (i + 0.5) / dpr - rMax, y = (j + 0.5) / dpr - rMax;
          const r = Math.max(Math.hypot(x, y), 1e-3);
          const a = deflection(r, rE, rc, rMax) / r / dMax; // deflection toward the hole, in units of dMax
          const o = 4 * (j * px + i);
          d[o] = Math.round(128 - 127 * a * x);
          d[o + 1] = Math.round(128 - 127 * a * y);
          d[o + 2] = 128; d[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      const url = canvas.toDataURL();
      image.setAttribute('href', url);
      image.setAttributeNS(XLINK, 'xlink:href', url);
      image.setAttribute('width', size); image.setAttribute('height', size);
    },
    /** Point the warp at client coordinates (x, y) with strength k in 0..1. */
    set(x, y, k) {
      if (k <= 0) { if (on) { target.style.filter = ''; on = false; } return; }
      const rect = target.getBoundingClientRect();
      image.setAttribute('x', (x - rect.left - rMax).toFixed(1));
      image.setAttribute('y', (y - rect.top - rMax).toFixed(1));
      disp.setAttribute('scale', (dMax * k / (127 / 255)).toFixed(2));
      if (!on) { target.style.filter = 'url(#page-warp)'; on = true; }
    },
    dispose() { target.style.filter = ''; svg.remove(); },
  };
}
