<script lang="ts">
  // Temporary chooser view: 30 alternative Hawk marks inspired by the current
  // logo. Pick one, then swap it into /logo.svg (glyph) and/or /favicon.svg
  // (badge). Each card renders a self-contained inline SVG so nothing here
  // depends on network fetches. `{@html}` is safe — every string below is
  // authored here, never from user input.
  const GOLD = '#e1b65a'
  const GOLD_DARK = '#b98a2e'
  const INK = '#101418'
  const CREAM = '#f4eee1'

  // The current hawk glyph, used as the base for every variant.
  const HAWK = `M270.508 39.456 C 197.513 43.441,138.160 81.051,94.253 151.142 C 89.828 158.208,89.824 158.219,91.193 159.588 C 93.241 161.636,93.841 161.072,114.032 138.086 C 169.580 74.847,221.047 47.763,285.859 47.662 C 289.978 47.655,291.443 47.130,292.376 45.325 C 295.105 40.048,289.112 38.440,270.508 39.456 M286.328 63.545 C 256.146 64.895,230.661 73.027,201.172 90.719 C 193.342 95.417,192.319 96.631,194.518 98.621 C 195.785 99.768,196.700 99.485,205.859 95.116 C 245.827 76.053,284.192 70.381,327.344 77.155 C 334.665 78.305,336.339 78.014,337.715 75.352 C 339.087 72.699,338.038 70.325,334.990 69.185 C 324.474 65.251,303.237 62.789,286.328 63.545 M279.688 92.443 C 272.636 93.114,270.114 93.938,269.729 95.693 C 269.308 97.610,270.167 98.237,273.930 98.760 C 275.700 99.006,279.170 99.485,281.641 99.825 C 307.597 103.397,332.530 113.336,358.611 130.506 C 368.367 136.928,370.188 137.514,372.249 134.894 C 374.430 132.121,372.343 128.595,364.258 121.396 C 341.877 101.466,307.720 89.772,279.688 92.443 M215.234 109.231 C 159.758 113.149,124.271 164.300,145.894 209.180 C 164.417 247.625,217.646 266.004,256.360 247.322 C 290.121 231.030,307.358 192.893,296.109 159.375 C 285.704 128.370,250.787 106.721,215.234 109.231 M290.067 124.442 C 288.762 125.747,289.317 126.269,297.471 131.407 C 324.597 148.500,351.814 172.949,370.379 196.899 C 373.007 200.289,373.787 200.763,375.208 199.832 C 377.015 198.649,376.852 197.766,373.653 191.395 C 358.072 160.365,328.857 135.271,296.830 125.406 C 291.028 123.619,290.907 123.602,290.067 124.442 M227.550 141.224 C 255.769 146.145,270.021 178.235,254.830 202.649 C 244.300 219.573,221.979 226.493,203.174 218.664 C 192.517 214.227,181.937 201.992,179.436 191.211 C 172.758 162.425,198.106 136.089,227.550 141.224 M126.836 169.782 C 118.599 173.982,108.923 175.532,92.188 175.330 L 81.055 175.195 77.221 177.038 C 47.152 191.490,27.723 225.779,31.276 258.121 C 33.192 275.560,43.379 295.339,53.885 302.021 C 57.325 304.208,57.645 303.725,56.640 297.850 C 51.858 269.878,69.288 252.291,107.813 246.216 C 122.102 243.963,151.220 246.268,165.801 250.806 C 168.956 251.788,168.901 251.656,164.953 248.790 C 143.922 233.520,130.631 212.655,128.112 190.952 C 127.563 186.222,127.809 173.515,128.504 170.749 C 129.041 168.609,129.085 168.635,126.836 169.782 M110.569 196.387 C 111.755 197.505,112.665 199.099,114.414 203.125 C 115.675 206.025,117.606 210.229,118.705 212.465 C 121.357 217.864,121.328 218.311,118.418 216.827 C 114.026 214.586,105.276 206.563,103.775 203.401 C 101.302 198.189,106.637 192.680,110.569 196.387 M325.301 199.121 C 324.971 199.497,324.304 200.596,323.820 201.563 C 307.558 234.017,270.002 263.726,239.711 268.099 C 232.463 269.145,232.893 272.656,240.268 272.656 C 279.083 272.656,320.814 239.485,328.909 202.197 C 329.585 199.080,327.157 197.010,325.301 199.121 M335.921 233.913 C 329.309 238.539,320.902 244.647,319.824 245.606 C 318.074 247.164,319.298 249.609,321.827 249.609 C 332.314 249.609,350.874 234.252,345.195 230.274 C 343.412 229.026,342.258 229.479,335.921 233.913 M105.273 260.016 C 96.677 260.938,85.646 264.191,87.537 265.247 C 87.839 265.415,91.419 266.027,95.494 266.605 C 141.467 273.133,183.967 304.350,210.562 351.124 C 213.242 355.839,215.557 357.235,216.233 354.545 C 217.186 350.747,211.461 329.280,206.841 319.325 C 189.561 282.094,144.546 255.808,105.273 260.016 M187.652 272.494 C 187.320 273.819,187.406 273.886,194.327 277.736 C 221.202 292.682,245.980 313.596,265.598 337.895 C 269.770 343.063,271.248 343.959,272.791 342.254 C 273.743 341.203,273.585 339.455,272.231 336.045 C 260.781 307.210,230.212 281.894,195.898 272.829 C 189.560 271.154,188.004 271.091,187.652 272.494 M298.242 272.925 C 288.663 273.554,286.719 274.068,286.719 275.977 C 286.719 277.567,287.978 278.045,294.922 279.095 C 308.823 281.197,320.400 283.924,341.602 290.087 C 354.348 293.793,355.031 293.907,356.459 292.565 C 360.038 289.203,355.552 284.901,342.856 279.522 C 330.622 274.338,314.052 271.888,298.242 272.925 M254.900 287.836 C 254.457 289.231,255.197 289.828,262.631 294.077 C 283.709 306.126,299.019 317.181,315.324 332.129 C 320.715 337.071,321.796 337.579,323.438 335.938 C 327.535 331.840,312.163 314.235,295.107 303.489 C 281.188 294.720,255.847 284.854,254.900 287.836`

  const glyph = (attrs = '') => `<path d="${HAWK}" ${attrs}></path>`

  // Scale the glyph about its centre (200,200), optionally shifting it.
  const fit = (s: number, dx = 0, dy = 0) =>
    `translate(${(200 + dx).toFixed(1)} ${(200 + dy).toFixed(1)}) scale(${s}) translate(-200 -200)`

  const svg = (inner: string) =>
    `<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`

  type Kind = 'glyph' | 'badge'
  interface Variant {
    id: number
    name: string
    kind: Kind
    svg: string
  }

  const variants: Variant[] = [
    { id: 1, name: 'Outline', kind: 'glyph',
      svg: svg(glyph(`fill="none" stroke="${GOLD}" stroke-width="7" stroke-linejoin="round" stroke-linecap="round"`)) },
    { id: 2, name: 'Mirrored', kind: 'glyph',
      svg: svg(`<g transform="translate(400 0) scale(-1 1)">${glyph(`fill="${GOLD}"`)}</g>`) },
    { id: 3, name: 'Diving', kind: 'glyph',
      svg: svg(`<g transform="translate(0 400) scale(1 -1)">${glyph(`fill="${GOLD}"`)}</g>`) },
    { id: 4, name: 'Bank left', kind: 'glyph',
      svg: svg(`<g transform="rotate(-15 200 200)">${glyph(`fill="${GOLD}"`)}</g>`) },
    { id: 5, name: 'Bank right', kind: 'glyph',
      svg: svg(`<g transform="rotate(15 200 200)">${glyph(`fill="${GOLD}"`)}</g>`) },
    { id: 6, name: 'Vertical', kind: 'glyph',
      svg: svg(`<g transform="rotate(90 200 200)">${glyph(`fill="${GOLD}"`)}</g>`) },
    { id: 7, name: 'Close-up', kind: 'glyph',
      svg: svg(glyph(`fill="${GOLD}" transform="${fit(1.3)}"`)) },
    { id: 8, name: 'Duotone', kind: 'glyph',
      svg: svg(`${glyph(`fill="${GOLD}"`)}${glyph(`fill="none" stroke="${GOLD_DARK}" stroke-width="5" stroke-linejoin="round"`)}`) },

    { id: 9, name: 'Circle · dark', kind: 'badge',
      svg: svg(`<circle cx="200" cy="200" r="200" fill="${INK}"/>${glyph(`fill="${GOLD}" transform="${fit(0.7)}"`)}`) },
    { id: 10, name: 'Circle · light', kind: 'badge',
      svg: svg(`<circle cx="200" cy="200" r="200" fill="${CREAM}"/>${glyph(`fill="${INK}" transform="${fit(0.7)}"`)}`) },
    { id: 11, name: 'Rounded square', kind: 'badge',
      svg: svg(`<rect x="36" y="36" width="328" height="328" rx="76" fill="${INK}"/>${glyph(`fill="${GOLD}" transform="${fit(0.6)}"`)}`) },
    { id: 12, name: 'Squircle', kind: 'badge',
      svg: svg(`<rect x="36" y="36" width="328" height="328" rx="118" fill="${INK}"/>${glyph(`fill="${GOLD}" transform="${fit(0.6)}"`)}`) },
    { id: 13, name: 'Hexagon', kind: 'badge',
      svg: svg(`<path d="M200 24 L352 112 L352 288 L200 376 L48 288 L48 112 Z" fill="${INK}"/>${glyph(`fill="${GOLD}" transform="${fit(0.5)}"`)}`) },
    { id: 14, name: 'Diamond', kind: 'badge',
      svg: svg(`<path d="M200 36 L364 200 L200 364 L36 200 Z" fill="${INK}"/>${glyph(`fill="${GOLD}" transform="${fit(0.46)}"`)}`) },
    { id: 15, name: 'Shield', kind: 'badge',
      svg: svg(`<path d="M200 28 C276 66 318 116 318 208 C318 296 262 348 200 374 C138 348 82 296 82 208 C82 116 124 66 200 28 Z" fill="${INK}"/>${glyph(`fill="${GOLD}" transform="${fit(0.48)}"`)}`) },
    { id: 16, name: 'Triangle', kind: 'badge',
      svg: svg(`<path d="M200 40 L362 356 L38 356 Z" fill="${INK}"/>${glyph(`fill="${GOLD}" transform="${fit(0.32, 0, 45)}"`)}`) },

    { id: 17, name: 'Ring', kind: 'glyph',
      svg: svg(`${glyph(`fill="${GOLD}" transform="${fit(0.55)}"`)}<circle cx="200" cy="200" r="150" fill="none" stroke="${GOLD}" stroke-width="16"/>`) },
    { id: 18, name: 'Double ring', kind: 'glyph',
      svg: svg(`${glyph(`fill="${GOLD}" transform="${fit(0.5)}"`)}<circle cx="200" cy="200" r="140" fill="none" stroke="${GOLD}" stroke-width="12"/><circle cx="200" cy="200" r="178" fill="none" stroke="${GOLD}" stroke-width="6"/>`) },
    { id: 19, name: 'Sunrise', kind: 'glyph',
      svg: svg(`${glyph(`fill="${GOLD}" transform="${fit(0.55)}"`)}<path d="M60 272 A140 140 0 0 1 340 272" fill="none" stroke="${GOLD}" stroke-width="14" stroke-linecap="round"/><line x1="60" y1="272" x2="340" y2="272" stroke="${GOLD}" stroke-width="14" stroke-linecap="round"/>`) },
    { id: 20, name: 'Crescent', kind: 'glyph',
      svg: svg(`${glyph(`fill="${GOLD}" transform="${fit(0.55)}"`)}<path d="M318 66 A158 158 0 1 0 318 334 A124 124 0 1 1 318 66" fill="none" stroke="${GOLD}" stroke-width="12" stroke-linejoin="round"/>`) },
    { id: 21, name: 'Mountain', kind: 'glyph',
      svg: svg(`${glyph(`fill="${GOLD}" transform="${fit(0.46, 0, -42)}"`)}<path d="M30 330 L150 150 L230 260 L290 190 L370 330" fill="none" stroke="${GOLD}" stroke-width="12" stroke-linejoin="round" stroke-linecap="round"/>`) },
    { id: 22, name: 'Speed', kind: 'glyph',
      svg: svg(`${glyph(`fill="${GOLD}" transform="${fit(0.55, 42, 0)}"`)}<path d="M40 172 H116 M40 202 H128 M40 232 H116" stroke="${GOLD}" stroke-width="10" stroke-linecap="round"/>`) },
    { id: 23, name: 'Swoosh', kind: 'glyph',
      svg: svg(`${glyph(`fill="${GOLD}" transform="${fit(0.5, 0, -28)}"`)}<path d="M56 302 C 150 218 244 342 344 250" fill="none" stroke="${GOLD}" stroke-width="12" stroke-linecap="round"/>`) },
    { id: 24, name: 'Wordmark', kind: 'glyph',
      svg: svg(`<text x="200" y="208" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-weight="700" font-size="88" letter-spacing="20" fill="${GOLD}">HAWK</text>${glyph(`fill="${GOLD}" transform="${fit(0.34, 0, 74)}"`)}`) },
    { id: 25, name: 'Symmetry', kind: 'glyph',
      svg: svg(`<g transform="${fit(0.42, -58, 0)}"><g transform="translate(400 0) scale(-1 1)">${glyph(`fill="${GOLD}"`)}</g></g><g transform="${fit(0.42, 58, 0)}">${glyph(`fill="${GOLD}"`)}</g>`) },
    { id: 26, name: 'Monogram H', kind: 'glyph',
      svg: svg(`${glyph(`fill="${GOLD}" transform="${fit(0.3)}"`)}<path d="M118 92 V308 M282 92 V308" stroke="${GOLD}" stroke-width="26" stroke-linecap="round"/>`) },
    { id: 27, name: 'Geometric', kind: 'glyph',
      svg: svg(`<path d="M50 160 L150 120 L200 190 L250 120 L350 160 L280 220 L310 320 L200 280 L90 320 L120 220 Z" fill="${GOLD}"/>`) },
    { id: 28, name: 'Gradient', kind: 'badge',
      svg: svg(`<defs><linearGradient id="lg28" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f2c96d"/><stop offset="0.5" stop-color="${GOLD}"/><stop offset="1" stop-color="${GOLD_DARK}"/></linearGradient></defs><circle cx="200" cy="200" r="200" fill="${INK}"/>${glyph(`fill="url(#lg28)" transform="${fit(0.7)}"`)}`) },
    { id: 29, name: 'Stripes', kind: 'glyph',
      svg: svg(`<defs><pattern id="st29" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="26" stroke="${GOLD}" stroke-width="11"/></pattern></defs>${glyph(`fill="url(#st29)"`)}`) },
    { id: 30, name: 'Split tone', kind: 'glyph',
      svg: svg(`<defs><clipPath id="cl30"><rect x="0" y="200" width="400" height="200"/></clipPath></defs>${glyph(`fill="${GOLD}"`)}${glyph(`fill="${GOLD_DARK}" clip-path="url(#cl30)"`)}`) },
  ]
</script>

<section class="picker">
  <header class="picker-head">
    <h1>Choose a logo</h1>
    <p>
      30 alternatives to the current hawk. <strong>Glyph</strong> marks are
      single-colour and can replace <code>/logo.svg</code>; <strong>badge</strong>
      marks carry their own background and can replace <code>/favicon.svg</code>.
      Tell me the number and I'll swap it in.
    </p>
  </header>

  <div class="grid">
    {#each variants as v (v.id)}
      <figure class="card">
        <div class="stage" class:glyph-stage={v.kind === 'glyph'}>
          {@html v.svg}
        </div>
        <figcaption>
          <span class="num">#{v.id}</span>
          <span class="name">{v.name}</span>
          <span class="kind">{v.kind}</span>
        </figcaption>
      </figure>
    {/each}
  </div>
</section>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    font-family: var(--font-ui, inherit);
  }
  .picker-head h1 {
    margin: 0 0 0.4rem;
    font-size: 1.4rem;
    color: var(--text);
  }
  .picker-head p {
    margin: 0;
    max-width: 60ch;
    color: var(--muted);
    font-size: 0.86rem;
    line-height: 1.55;
  }
  .picker-head code {
    font-family: var(--font-mono);
    color: var(--accent);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(148px, 1fr));
    gap: 0.9rem;
  }

  .card {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .stage {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    padding: 0.75rem;
    border-radius: var(--r-md);
    border: 1px solid var(--line);
    background: var(--panel);
    overflow: hidden;
  }
  /* Glyphs are transparent amber marks, so give them a consistent dark field
     to sit on — matching the current identity (amber on near-black). */
  .stage.glyph-stage {
    background: #14171c;
    border-color: rgba(255, 255, 255, 0.06);
  }
  .stage :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }

  figcaption {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    line-height: 1.2;
  }
  .num {
    color: var(--accent);
    font-family: var(--font-mono);
    font-size: 0.72rem;
  }
  .name {
    color: var(--text);
    font-size: 0.82rem;
    flex: 1;
  }
  .kind {
    color: var(--muted);
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
</style>
