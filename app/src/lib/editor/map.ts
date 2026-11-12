import { Node, mergeAttributes } from '@tiptap/core'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { openMapPrompt } from './mapPrompt'

type Position = [number, number]

export interface MapFeatureProperties {
  name: string
  address?: string
  website?: string
  google_place_id?: string
}

export interface ParsedMap {
  title: string | null
  center: Position | null
  zoom: number | null
  data: GeoJSON.FeatureCollection<GeoJSON.Geometry, MapFeatureProperties>
}

export class MapDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MapDataError'
  }
}

// Shown as the placeholder in an empty map prompt: the shape the pasted data
// needs, without inserting anything into the note.
export const MAP_EXAMPLE = `{
  "type": "FeatureCollection",
  "properties": { "title": "Map", "center": [18.065, 59.329], "zoom": 12 },
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [18.065, 59.329] },
      "properties": { "name": "New place" }
    }
  ]
}`

const TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isPosition = (value: unknown): value is Position =>
  Array.isArray(value) &&
  value.length >= 2 &&
  typeof value[0] === 'number' &&
  Number.isFinite(value[0]) &&
  value[0] >= -180 &&
  value[0] <= 180 &&
  typeof value[1] === 'number' &&
  Number.isFinite(value[1]) &&
  value[1] >= -90 &&
  value[1] <= 90

const isPositionList = (value: unknown): value is Position[] => Array.isArray(value) && value.length > 0 && value.every(isPosition)

const isRing = (value: unknown): value is Position[] => isPositionList(value) && value.length >= 4

function isGeometry(value: unknown): value is GeoJSON.Geometry {
  if (!isObject(value) || typeof value.type !== 'string') return false
  const coordinates = value.coordinates
  switch (value.type) {
    case 'Point':
      return isPosition(coordinates)
    case 'MultiPoint':
      return isPositionList(coordinates)
    case 'LineString':
      return isPositionList(coordinates) && coordinates.length >= 2
    case 'MultiLineString':
      return Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every((line) => isPositionList(line) && line.length >= 2)
    case 'Polygon':
      return Array.isArray(coordinates) && coordinates.length > 0 && coordinates.every(isRing)
    case 'MultiPolygon':
      return (
        Array.isArray(coordinates) &&
        coordinates.length > 0 &&
        coordinates.every((polygon) => Array.isArray(polygon) && polygon.length > 0 && polygon.every(isRing))
      )
    case 'GeometryCollection':
      return Array.isArray(value.geometries) && value.geometries.every(isGeometry)
    default:
      return false
  }
}

function parseFeature(value: unknown, index: number): GeoJSON.Feature<GeoJSON.Geometry, MapFeatureProperties> {
  if (!isObject(value) || value.type !== 'Feature') {
    throw new MapDataError(`Feature ${index + 1} isn’t a GeoJSON Feature.`)
  }
  if (!isGeometry(value.geometry)) {
    throw new MapDataError(`Feature ${index + 1} has an unsupported or invalid geometry.`)
  }
  const raw = isObject(value.properties) ? value.properties : {}
  if (typeof raw.name !== 'string' || !raw.name.trim()) {
    throw new MapDataError(`Feature ${index + 1} needs a name.`)
  }
  const properties: MapFeatureProperties = { name: raw.name.trim() }
  for (const key of ['address', 'website', 'google_place_id'] as const) {
    const v = raw[key]
    if (typeof v === 'string' && v.trim()) properties[key] = v.trim()
  }
  return { type: 'Feature', geometry: value.geometry, properties }
}

// Parse and validate a ```map fenced block. Coordinates are [longitude,
// latitude], per RFC 7946.
export function parseMapSource(source: string): ParsedMap {
  if (!source.trim()) throw new MapDataError('Paste some GeoJSON first.')
  let root: unknown
  try {
    root = JSON.parse(source)
  } catch {
    throw new MapDataError('That map data isn’t valid JSON.')
  }
  if (!isObject(root) || root.type !== 'FeatureCollection' || !Array.isArray(root.features)) {
    throw new MapDataError('That map data isn’t a GeoJSON FeatureCollection.')
  }

  const properties = isObject(root.properties) ? root.properties : {}
  let title: string | null = null
  if (properties.title !== undefined) {
    if (typeof properties.title !== 'string') throw new MapDataError('The map title should be text.')
    title = properties.title.trim() || null
  }

  let center: Position | null = null
  if (properties.center !== undefined) {
    if (!isPosition(properties.center)) throw new MapDataError('The map center should be [longitude, latitude].')
    center = [properties.center[0], properties.center[1]]
  }

  let zoom: number | null = null
  if (properties.zoom !== undefined) {
    if (typeof properties.zoom !== 'number' || !Number.isFinite(properties.zoom)) {
      throw new MapDataError('The map zoom should be a number.')
    }
    zoom = Math.max(0, Math.min(19, properties.zoom))
  }

  const features = root.features.map(parseFeature)
  if (!features.length && !center) throw new MapDataError('That map has no features to show.')

  return { title, center, zoom, data: { type: 'FeatureCollection', features } }
}

export function safeHttpUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

// Popup contents are built as DOM nodes: property values are text, never HTML.
export function mapPopupContent(feature: GeoJSON.Feature<GeoJSON.Geometry, MapFeatureProperties>): HTMLElement {
  const properties = feature.properties ?? { name: '' }
  const root = document.createElement('div')
  root.className = 'note-map-popup'

  const name = document.createElement('strong')
  name.className = 'note-map-popup-name'
  name.textContent = properties.name
  root.append(name)

  if (properties.address) {
    const address = document.createElement('p')
    address.className = 'note-map-popup-address'
    address.textContent = properties.address
    root.append(address)
  }

  const website = safeHttpUrl(properties.website)
  if (website) {
    const link = document.createElement('a')
    link.className = 'note-map-popup-link'
    link.href = website
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = properties.website!.trim()
    root.append(link)
  }

  if (properties.google_place_id) {
    const link = document.createElement('a')
    link.className = 'note-map-popup-link'
    link.href = `https://www.google.com/maps/place/?q=place_id=${encodeURIComponent(properties.google_place_id)}`
    link.target = '_blank'
    link.rel = 'noopener noreferrer'
    link.textContent = 'Open in Google Maps'
    root.append(link)
  }

  return root
}

const MARKER_ICON = L.divIcon({
  className: 'note-map-marker',
  html: '<svg viewBox="0 0 24 32" aria-hidden="true"><path d="M12 1C6.2 1 1.5 5.7 1.5 11.5c0 8.1 10.5 19.5 10.5 19.5s10.5-11.4 10.5-19.5C22.5 5.7 17.8 1 12 1Z" fill="currentColor"/><circle class="note-map-marker-dot" cx="12" cy="11.5" r="4"/></svg>',
  iconSize: [24, 32],
  iconAnchor: [12, 32],
  popupAnchor: [0, -30],
})

// Toolbar icons, drawn in the app's 16px stroke style.
const ICONS = {
  edit: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.9 2.6a1.6 1.6 0 0 1 2.3 2.3L5.7 12.4l-2.9.8.8-2.9z" /><path d="M9.6 3.9l2.3 2.3" /></svg>',
  fullscreen:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 6V2.5H6M13.5 6V2.5H10M2.5 10v3.5H6M13.5 10v3.5H10" /></svg>',
  exitFullscreen:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2.5V6H2.5M10 2.5V6h3.5M6 13.5V10H2.5M10 13.5V10h3.5" /></svg>',
}

function mountMap(canvas: HTMLElement, parsed: ParsedMap): L.Map {
  const map = L.map(canvas, { scrollWheelZoom: false })
  L.tileLayer(TILE_URL, { maxZoom: 19, attribution: ATTRIBUTION }).addTo(map)
  const geo = L.geoJSON(parsed.data, {
    pointToLayer: (_feature, latlng) => L.marker(latlng, { icon: MARKER_ICON, keyboard: true }),
    onEachFeature: (feature, layer) => {
      layer.bindPopup(() => mapPopupContent(feature as GeoJSON.Feature<GeoJSON.Geometry, MapFeatureProperties>))
    },
  }).addTo(map)

  if (parsed.center) {
    map.setView([parsed.center[1], parsed.center[0]], parsed.zoom ?? 13)
  } else {
    const bounds = geo.getBounds()
    if (!bounds.isValid()) {
      map.remove()
      throw new MapDataError('That map has no features to show.')
    }
    map.fitBounds(bounds, { padding: [24, 24], maxZoom: parsed.zoom ?? 16 })
  }
  return map
}

function mapNodeView() {
  return ({ node, editor, getPos }: { node: any; editor: any; getPos: () => number | undefined }) => {
    const dom = document.createElement('div')
    dom.className = 'note-map'
    dom.contentEditable = 'false'
    let current = node
    let map: L.Map | null = null
    let frame = 0
    let observer: ResizeObserver | null = null
    let widthObserver: ResizeObserver | null = null
    let destroyed = false
    let fullscreen = false
    let fullscreenButton: HTMLButtonElement | null = null

    const clear = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      observer?.disconnect()
      observer = null
      map?.remove()
      map = null
      fullscreenButton = null
      dom.replaceChildren()
    }

    const edit = () => {
      openMapPrompt({
        title: 'Edit map data',
        submitLabel: 'Update map',
        source: current.attrs.source ?? '',
        onSave: (source) => {
          if (!editor.isEditable) return
          const pos = typeof getPos === 'function' ? getPos() : undefined
          if (pos == null) return
          editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { source }))
        },
      })
    }

    const clickable = (el: HTMLButtonElement, onClick: () => void) => {
      el.type = 'button'
      el.addEventListener('mousedown', (e) => e.preventDefault())
      el.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        onClick()
      })
      return el
    }

    const textButton = (label: string, ariaLabel: string, onClick: () => void) => {
      const el = document.createElement('button')
      el.className = 'note-map-button'
      el.textContent = label
      el.setAttribute('aria-label', ariaLabel)
      return clickable(el, onClick)
    }

    const iconButton = (svg: string, label: string, onClick: () => void) => {
      const el = document.createElement('button')
      el.className = 'note-map-icon'
      el.innerHTML = svg
      el.title = label
      el.setAttribute('aria-label', label)
      return clickable(el, onClick)
    }

    const addActions = (withFullscreen: boolean) => {
      if (!editor.isEditable) return
      const actions = document.createElement('div')
      actions.className = 'note-map-actions'
      if (withFullscreen) {
        fullscreenButton = iconButton(fullscreen ? ICONS.exitFullscreen : ICONS.fullscreen, fullscreen ? 'Exit full screen' : 'Full screen', () =>
          setFullscreen(!fullscreen),
        )
        fullscreenButton.setAttribute('aria-pressed', String(fullscreen))
        actions.append(fullscreenButton)
      }
      actions.append(iconButton(ICONS.edit, 'Edit map data', edit))
      dom.append(actions)
    }

    // The note text column is capped at 70ch; the map uses the whole pane.
    const sizeToNote = (root?: HTMLElement | null) => {
      const pane = root ?? (dom.closest('.rich-editor') as HTMLElement | null)
      const parent = dom.parentElement
      if (!pane || !parent) return
      if (fullscreen) {
        dom.style.width = ''
        dom.style.marginLeft = ''
        return
      }
      const paneStyle = getComputedStyle(pane)
      const padLeft = parseFloat(paneStyle.paddingLeft) || 0
      const padRight = parseFloat(paneStyle.paddingRight) || 0
      const width = pane.clientWidth - padLeft - padRight
      if (width <= parent.clientWidth) {
        dom.style.width = ''
        dom.style.marginLeft = ''
        return
      }
      const parentLeft = parent.getBoundingClientRect().left + (parseFloat(getComputedStyle(parent).paddingLeft) || 0)
      const paneLeft = pane.getBoundingClientRect().left + padLeft
      dom.style.width = `${width}px`
      dom.style.marginLeft = `${paneLeft - parentLeft}px`
    }

    const onKeydown = (e: KeyboardEvent) => {
      if (!fullscreen || e.key !== 'Escape' || e.defaultPrevented) return
      // The map data prompt sits on top and handles its own Escape.
      if ((e.target as HTMLElement | null)?.closest('.map-prompt-layer')) return
      e.preventDefault()
      e.stopPropagation()
      setFullscreen(false)
    }

    function setFullscreen(on: boolean) {
      if (fullscreen === on) return
      fullscreen = on
      dom.classList.toggle('is-fullscreen', on)
      document.body.classList.toggle('note-map-fullscreen', on)
      if (on) document.addEventListener('keydown', onKeydown, true)
      else document.removeEventListener('keydown', onKeydown, true)
      if (fullscreenButton) {
        fullscreenButton.innerHTML = on ? ICONS.exitFullscreen : ICONS.fullscreen
        fullscreenButton.title = on ? 'Exit full screen' : 'Full screen'
        fullscreenButton.setAttribute('aria-label', on ? 'Exit full screen' : 'Full screen')
        fullscreenButton.setAttribute('aria-pressed', String(on))
      }
      sizeToNote()
      requestAnimationFrame(() => map?.invalidateSize())
      fullscreenButton?.focus()
    }

    const showError = (message: string) => {
      const error = document.createElement('div')
      error.className = 'note-map-error'
      error.setAttribute('role', 'alert')
      error.textContent = message
      dom.append(error)
    }

    const showPlaceholder = () => {
      const empty = document.createElement('div')
      empty.className = 'note-map-empty'
      const text = document.createElement('p')
      text.textContent = 'No map data yet.'
      empty.append(text)
      if (editor.isEditable) empty.append(textButton('Add data', 'Add map data', edit))
      dom.append(empty)
    }

    const render = (source: string) => {
      clear()
      if (!source.trim()) {
        if (fullscreen) setFullscreen(false)
        showPlaceholder()
        return
      }
      let parsed: ParsedMap
      try {
        parsed = parseMapSource(source)
      } catch (error) {
        if (fullscreen) setFullscreen(false)
        showError(error instanceof MapDataError ? error.message : 'Could not read this map.')
        addActions(false)
        return
      }

      if (parsed.title) {
        const title = document.createElement('div')
        title.className = 'note-map-title'
        title.textContent = parsed.title
        dom.append(title)
      }

      const canvas = document.createElement('div')
      canvas.className = 'note-map-canvas'
      canvas.setAttribute('role', 'region')
      canvas.setAttribute('aria-label', parsed.title || 'Map')
      dom.append(canvas)
      try {
        map = mountMap(canvas, parsed)
        frame = requestAnimationFrame(() => {
          frame = 0
          if (!destroyed) map?.invalidateSize()
        })
        if (typeof ResizeObserver !== 'undefined') {
          observer = new ResizeObserver(() => map?.invalidateSize())
          observer.observe(canvas)
        }
      } catch (error) {
        canvas.remove()
        showError(error instanceof MapDataError ? error.message : 'Could not show this map.')
      }
      addActions(true)
      sizeToNote()
    }

    render(current.attrs.source ?? '')

    // Node views are created detached, so wait until the editor has mounted the
    // DOM to measure the note pane.
    queueMicrotask(() => {
      if (destroyed || typeof ResizeObserver === 'undefined') return
      const pane = dom.closest('.rich-editor')
      if (!(pane instanceof HTMLElement)) return
      widthObserver = new ResizeObserver(() => sizeToNote(pane))
      widthObserver.observe(pane)
      sizeToNote(pane)
    })

    return {
      dom,
      update(updated: any) {
        if (updated.type.name !== current.type.name) return false
        const previousSource = current.attrs.source
        current = updated
        if (updated.attrs.source !== previousSource) render(current.attrs.source ?? '')
        return true
      },
      destroy() {
        destroyed = true
        document.removeEventListener('keydown', onKeydown, true)
        document.body.classList.remove('note-map-fullscreen')
        widthObserver?.disconnect()
        widthObserver = null
        clear()
      },
    }
  }
}

// A fenced ```map block: GeoJSON rendered as an interactive Leaflet map.
export const MapBlock = Node.create({
  name: 'mapBlock',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return {
      source: { default: '' },
    }
  },
  parseHTML() {
    return [
      {
        tag: 'pre',
        priority: 100,
        getAttrs: (el: HTMLElement) => {
          const code = el.querySelector('code')
          if (!code?.classList.contains('language-map')) return false
          return { source: code.textContent ?? '' }
        },
      },
    ]
  },
  renderHTML({ node }) {
    return [
      'pre',
      mergeAttributes({ 'data-map': '' }),
      ['code', { class: 'language-map' }, node.attrs.source ?? ''],
    ]
  },
  addNodeView: mapNodeView,
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any) {
          state.write('```map\n')
          state.text(node.attrs.source ?? '', false)
          state.ensureNewLine()
          state.write('```')
          state.closeBlock(node)
        },
        parse: {
          updateDOM(element: HTMLElement) {
            element.innerHTML = element.innerHTML.replace(/\n<\/code><\/pre>/g, '</code></pre>')
          },
        },
      },
    }
  },
})
