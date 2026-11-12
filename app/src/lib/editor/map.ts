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

// A valid starting point for the insert menu. It gives a prompt with the right
// shape without inserting anything until the data is filled in or replaced.
export const MAP_TEMPLATE = `{
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
    let destroyed = false

    const clear = () => {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      observer?.disconnect()
      observer = null
      map?.remove()
      map = null
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

    const addEditButton = () => {
      if (!editor.isEditable) return
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'note-map-edit'
      button.textContent = 'Edit data'
      button.setAttribute('aria-label', 'Edit map data')
      button.addEventListener('mousedown', (e) => e.preventDefault())
      button.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        edit()
      })
      dom.append(button)
    }

    const showError = (message: string) => {
      const error = document.createElement('div')
      error.className = 'note-map-error'
      error.setAttribute('role', 'alert')
      error.textContent = message
      dom.append(error)
    }

    const render = (source: string) => {
      clear()
      let parsed: ParsedMap
      try {
        parsed = parseMapSource(source)
      } catch (error) {
        showError(error instanceof MapDataError ? error.message : 'Could not read this map.')
        addEditButton()
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
      addEditButton()
    }

    render(current.attrs.source ?? '')

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
