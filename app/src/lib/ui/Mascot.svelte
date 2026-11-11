<script lang="ts">
  import { onMount } from 'svelte'
  import { fade } from 'svelte/transition'

  // A tiny 8-bit hawk that ambles around the viewport while you work.
  // It is deliberately pointer-events: none — scenery, not a button.

  const SIZE = 34
  const EDGE = 24

  const PALETTE: Record<string, string> = {
    b: '#c67b3d', // body
    B: '#8a4d22', // wing / dark feathers
    l: '#f3c98a', // face / belly
    e: '#1a1512', // eye
    w: '#fffaf0', // eye glint
    k: '#f6c453', // beak
    f: '#e6b84d', // feet
  }

  const FRAME_A = [
    '................',
    '................',
    '......bbbb......',
    '....bbbbbbbb....',
    '...bbbbbbbbbb...',
    '..bbbewbbbbkkb..',
    '..bbbewbbbbkkb..',
    '..bbbbbbbbbbbb..',
    '...bBBBbbbbbb...',
    '...bBBBbbbbb....',
    '....bbbbbbb.....',
    '....bblllbb.....',
    '....bblllbb.....',
    '....bbbbbbb.....',
    '.....f...f......',
    '.....f...f......',
  ]

  const FRAME_B = [
    '................',
    '................',
    '......bbbb......',
    '....bbbbbbbb....',
    '...bbbbbbbbbb...',
    '..bbbewbbbbkkb..',
    '..bbbewbbbbkkb..',
    '..bbbbbbbbbbbb..',
    '...bBBBbbbbbb...',
    '...bBBBbbbbb....',
    '....bbbbbbb.....',
    '....bblllbb.....',
    '....bblllbb.....',
    '....bbbbbbb.....',
    '....f.....f.....',
    '................',
  ]

  type Pixel = { x: number; y: number; fill: string; key: string }

  function parseFrame(rows: readonly string[]): Pixel[] {
    const pixels: Pixel[] = []
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const fill = PALETTE[row[x]]
        if (fill) pixels.push({ x, y, fill, key: `${x}:${y}` })
      }
    })
    return pixels
  }

  const frames = [parseFrame(FRAME_A), parseFrame(FRAME_B)]

  let ready = $state(false)
  let x = $state(0)
  let y = $state(0)
  let facing = $state<1 | -1>(1)
  let moving = $state(false)
  let moveMs = $state(0)
  let frameIndex = $state(0)

  let waypointTimer: ReturnType<typeof setTimeout> | null = null
  let arrivalTimer: ReturnType<typeof setTimeout> | null = null
  let walkTimer: ReturnType<typeof setInterval> | null = null

  function bounds() {
    const maxX = Math.max(EDGE, window.innerWidth - SIZE - EDGE)
    const maxY = Math.max(EDGE, window.innerHeight - SIZE - EDGE)
    return { minX: EDGE, maxX, minY: EDGE, maxY }
  }

  function randomBetween(min: number, max: number) {
    return min + Math.random() * (max - min)
  }

  function clearTimers() {
    if (waypointTimer) clearTimeout(waypointTimer)
    if (arrivalTimer) clearTimeout(arrivalTimer)
    if (walkTimer) clearInterval(walkTimer)
    waypointTimer = null
    arrivalTimer = null
    walkTimer = null
  }

  function clampToBounds() {
    const { minX, maxX, minY, maxY } = bounds()
    x = Math.min(Math.max(x, minX), maxX)
    y = Math.min(Math.max(y, minY), maxY)
  }

  function pickWaypoint() {
    const { minX, maxX, minY, maxY } = bounds()
    const tx = randomBetween(minX, maxX)
    const ty = randomBetween(minY, maxY)
    const distance = Math.hypot(tx - x, ty - y)

    // Wander at a gentle, constant-ish speed. The transition itself is
    // driven by CSS so the timer here only decides when to rest again.
    moveMs = Math.max(900, Math.min(7000, (distance / 46) * 1000))
    if (Math.abs(tx - x) > 6) facing = tx > x ? 1 : -1
    x = tx
    y = ty
    moving = true

    if (arrivalTimer) clearTimeout(arrivalTimer)
    arrivalTimer = setTimeout(() => {
      moving = false
      scheduleWaypoint()
    }, moveMs)
  }

  function scheduleWaypoint() {
    if (waypointTimer) clearTimeout(waypointTimer)
    waypointTimer = setTimeout(pickWaypoint, 1400 + Math.random() * 2600)
  }

  onMount(() => {
    const { minX, maxX, minY, maxY } = bounds()
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // Reduced motion: settle quietly in the corner instead of wandering.
    x = reduceMotion ? maxX : randomBetween(minX, maxX)
    y = reduceMotion ? maxY : randomBetween(minY, maxY)
    if (!reduceMotion) {
      facing = Math.random() > 0.5 ? 1 : -1
      scheduleWaypoint()
      walkTimer = setInterval(() => {
        if (moving) frameIndex = frameIndex === 0 ? 1 : 0
      }, 280)
    }
    ready = true
    window.addEventListener('resize', clampToBounds)

    return () => {
      clearTimers()
      window.removeEventListener('resize', clampToBounds)
    }
  })
</script>

{#if ready}
  <div
    class="mascot"
    style:left={`${x}px`}
    style:top={`${y}px`}
    style:transition-duration={`${moveMs}ms`}
    aria-hidden="true"
    in:fade={{ duration: 600 }}
  >
    <div class="sprite-shell" class:flip={facing === -1}>
      <svg class="sprite" class:hop={moving} viewBox="0 0 16 16" width={SIZE} height={SIZE}>
        <g shape-rendering="crispEdges">
          {#each frames[frameIndex] as pixel (pixel.key)}
            <rect x={pixel.x} y={pixel.y} width="1" height="1" fill={pixel.fill} />
          {/each}
        </g>
      </svg>
    </div>
  </div>
{/if}

<style>
  .mascot {
    position: fixed;
    left: 0;
    top: 0;
    width: var(--mascot-size, 34px);
    height: var(--mascot-size, 34px);
    z-index: var(--z-sticky);
    pointer-events: none;
    transition-property: left, top;
    transition-timing-function: linear;
    transition-duration: var(--dur-slow);
  }
  .sprite-shell {
    width: 100%;
    height: 100%;
    display: block;
  }
  .sprite-shell.flip {
    transform: scaleX(-1);
  }
  .sprite {
    display: block;
    width: 100%;
    height: 100%;
    filter: drop-shadow(0 2px 0 rgb(0 0 0 / 0.15));
  }
  .sprite.hop {
    animation: mascot-hop 0.28s ease-in-out infinite;
  }
  @keyframes mascot-hop {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-3px); }
  }
  @media (prefers-reduced-motion: reduce) {
    .mascot {
      transition-duration: 0.01ms;
    }
    .sprite.hop {
      animation: none;
    }
  }
</style>
