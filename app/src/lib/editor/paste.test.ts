import { describe, expect, it } from 'vitest'
import { bulletsToMarkdown, looksLikeMarkdown, normalizePastedHtml, splitSoftBreaks } from './paste'

describe('looksLikeMarkdown', () => {
  it('detects common syntax', () => {
    expect(looksLikeMarkdown('# Title')).toBe(true)
    expect(looksLikeMarkdown('- a\n- b')).toBe(true)
    expect(looksLikeMarkdown('see [docs](https://x.y)')).toBe(true)
    expect(looksLikeMarkdown('some **bold** text')).toBe(true)
  })
  it('ignores prose', () => {
    expect(looksLikeMarkdown('Just a sentence.\nAnother line.')).toBe(false)
    expect(looksLikeMarkdown('snake_case_name is fine')).toBe(false)
  })
})

describe('splitSoftBreaks', () => {
  it('keeps consecutive plain lines as separate paragraphs', () => {
    expect(splitSoftBreaks('# T\nline a\nline b')).toBe('# T\nline a\n\nline b')
  })
  it('leaves lists and code fences alone', () => {
    expect(splitSoftBreaks('- a\n- b')).toBe('- a\n- b')
    expect(splitSoftBreaks('```\nx\ny\n```')).toBe('```\nx\ny\n```')
  })
})


const norm = (html: string) => normalizePastedHtml(html).replace(/>\s+</g, '><').trim()

describe('normalizePastedHtml', () => {
  it('splits <br> lines into paragraphs', () => {
    expect(norm('<p>one<br>two<br><br>three</p>')).toBe('<p>one</p><p>two</p><p>three</p>')
  })

  it('turns per-line divs (Apple Notes, Gmail) into paragraphs and drops blank ones', () => {
    expect(norm('<div>one</div><div><br></div><div>two</div>')).toBe('<p>one</p><p>two</p>')
  })

  it('turns styled spans into marks and unwraps the Google Docs wrapper', () => {
    const html =
      '<b style="font-weight:normal;" id="docs-internal-guid-1"><p><span style="font-weight:700">Bold</span> and <span style="font-style:italic">it</span></p></b>'
    expect(norm(html)).toBe('<p><strong>Bold</strong> and <em>it</em></p>')
  })

  it('reads big-font lines as headings', () => {
    expect(norm('<p><span style="font-size:24px">Title</span></p><p>body</p>')).toMatch(/^<h2>Title<\/h2>/)
    expect(norm('<p><span style="font-size:14pt">Section</span></p><p>body</p>')).toMatch(/^<h3>Section<\/h3>/)
  })

  it('makes a short bold line that introduces text a heading', () => {
    expect(norm('<p><b>Agenda</b></p><p>First thing.</p>')).toBe('<h3>Agenda</h3><p>First thing.</p>')
    // …but not a bold sentence, or the last line.
    expect(norm('<p><b>Do this now.</b></p><p>x</p>')).toBe('<p><b>Do this now.</b></p><p>x</p>')
    expect(norm('<p>x</p><p><b>End</b></p>')).toContain('<b>End</b>')
  })

  it('builds lists from bullet and number markers', () => {
    expect(norm('<p>• one</p><p>• two</p><p>after</p>')).toBe('<ul><li><p>one</p></li><li><p>two</p></li></ul><p>after</p>')
    expect(norm('<p>1. one</p><p>2) two</p>')).toBe('<ol><li><p>one</p></li><li><p>two</p></li></ol>')
  })

  it('reads Word list paragraphs', () => {
    const html =
      '<p class="MsoListParagraph" style="mso-list:l0 level1 lfo1"><span style="mso-list:Ignore">·<span>&nbsp;&nbsp;</span></span>Item<o:p></o:p></p>'
    expect(norm(html)).toBe('<ul><li><p>Item</p></li></ul>')
  })

  it('maps heading levels onto the editor’s', () => {
    expect(norm('<h1>A</h1><h5>B</h5>')).toBe('<h2>A</h2><h3>B</h3>')
  })

  it('leaves real lists alone', () => {
    expect(norm('<ul><li><p>• odd</p></li></ul>')).toBe('<ul><li><p>• odd</p></li></ul>')
  })
})

describe('bulletsToMarkdown', () => {
  it('rewrites bullet characters as markdown items', () => {
    expect(bulletsToMarkdown('• a\n  ◦ b\nplain')).toBe('- a\n  - b\nplain')
  })
})
