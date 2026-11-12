import { describe, expect, it } from 'vitest'
import { MapDataError, mapPopupContent, parseMapSource, safeHttpUrl } from './map'

const feature = (properties: Record<string, unknown> = {}, coordinates: unknown = [18.0498802, 59.3410997]) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates },
  properties,
})

const collection = (features: unknown[], properties?: Record<string, unknown>) =>
  JSON.stringify({ type: 'FeatureCollection', ...(properties ? { properties } : {}), features })

describe('parseMapSource', () => {
  it('reads a FeatureCollection, title, center and zoom', () => {
    const parsed = parseMapSource(
      collection([feature({ name: 'Old Touch', address: 'Upplandsgatan 43' })], {
        title: 'Example',
        center: [18.065, 59.329],
        zoom: 13,
      }),
    )
    expect(parsed.title).toBe('Example')
    expect(parsed.center).toEqual([18.065, 59.329])
    expect(parsed.zoom).toBe(13)
    expect(parsed.data.features[0].properties).toEqual({ name: 'Old Touch', address: 'Upplandsgatan 43' })
  })

  it('leaves center and zoom out so the map can fit its features', () => {
    const parsed = parseMapSource(collection([feature({ name: 'One' })]))
    expect(parsed.center).toBeNull()
    expect(parsed.zoom).toBeNull()
  })

  it('supports standard geometry types', () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { name: 'Line' } },
        {
          type: 'Feature',
          geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
          properties: { name: 'Area' },
        },
      ],
    })
    expect(() => parseMapSource(geojson)).not.toThrow()
  })

  it('reports invalid JSON and non-FeatureCollections', () => {
    expect(() => parseMapSource('{ nope')).toThrow(MapDataError)
    expect(() => parseMapSource('{ nope')).toThrow('valid JSON')
    expect(() => parseMapSource('{"type":"Feature"}')).toThrow('FeatureCollection')
  })

  it('rejects features without a name or with bad coordinates', () => {
    expect(() => parseMapSource(collection([feature({})]))).toThrow('needs a name')
    expect(() => parseMapSource(collection([feature({ name: 'Off world' }, [200, 59])]))).toThrow('geometry')
    expect(() => parseMapSource(collection([feature({ name: 'Swapped' }, [59.3, 18.0])]))).not.toThrow()
    expect(() => parseMapSource(collection([feature({ name: 'Too high' }, [18.0, 95])]))).toThrow('geometry')
  })

  it('rejects a map with neither features nor a center', () => {
    expect(() => parseMapSource(collection([]))).toThrow('no features')
    expect(() => parseMapSource(collection([], { center: [18, 59] }))).not.toThrow()
  })

  it('validates optional map properties', () => {
    expect(() => parseMapSource(collection([feature({ name: 'A' })], { center: [1] }))).toThrow('center')
    expect(() => parseMapSource(collection([feature({ name: 'A' })], { zoom: 'near' }))).toThrow('zoom')
  })
})

describe('safeHttpUrl', () => {
  it('allows only http and https', () => {
    expect(safeHttpUrl('https://example.com/a')).toBe('https://example.com/a')
    expect(safeHttpUrl('http://example.com')).toBe('http://example.com/')
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(safeHttpUrl('data:text/html,hi')).toBeNull()
    expect(safeHttpUrl('not a url')).toBeNull()
  })
})

describe('mapPopupContent', () => {
  const popup = (properties: Record<string, unknown>) =>
    mapPopupContent({ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: properties as never })

  it('renders property values as text, not HTML', () => {
    const el = popup({ name: '<img src=x onerror=alert(1)>', address: 'A & B <b>bold</b>' })
    expect(el.querySelector('.note-map-popup-name')?.textContent).toBe('<img src=x onerror=alert(1)>')
    expect(el.querySelector('.note-map-popup-address')?.textContent).toBe('A & B <b>bold</b>')
    expect(el.querySelector('img')).toBeNull()
    expect(el.querySelector('.note-map-popup-address b')).toBeNull()
  })

  it('links websites only when they are http(s)', () => {
    const ok = popup({ name: 'One', website: 'https://www.oldtouch.se/' })
    expect(ok.querySelectorAll('a')).toHaveLength(1)
    expect(ok.querySelector('a')?.getAttribute('href')).toBe('https://www.oldtouch.se/')

    const bad = popup({ name: 'Two', website: 'javascript:alert(1)' })
    expect(bad.querySelectorAll('a')).toHaveLength(0)
  })

  it('adds an encoded Google Maps place link', () => {
    const el = popup({ name: 'Old Touch', google_place_id: 'ChIJ3-M-im-dX0YR2NRz9gi2h3U&next=1' })
    expect(el.querySelector('a')?.getAttribute('href')).toBe(
      'https://www.google.com/maps/place/?q=place_id=ChIJ3-M-im-dX0YR2NRz9gi2h3U%26next%3D1',
    )
    expect(el.querySelector('a')?.textContent).toBe('Open in Google Maps')
  })
})
