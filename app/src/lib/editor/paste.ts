// Heuristics for deciding how to treat pasted plain text.

const MD_PATTERNS = [
  /^#{1,6}\s+\S/m, // heading
  /^\s*[-*+]\s+\S/m, // bullet
  /^\s*\d+[.)]\s+\S/m, // ordered item
  /^\s*>\s?\S/m, // quote
  /^```/m, // fence
  /\*\*[^*\n]+\*\*/, // bold
  /(^|[^\w*])_[^_\n]+_(?!\w)/, // italic
  /\[[^\]\n]+\]\([^)\s]+\)/, // link
  /`[^`\n]+`/, // inline code
  /^\s*[-*_]{3,}\s*$/m, // rule
]

export function looksLikeMarkdown(text: string): boolean {
  return MD_PATTERNS.some((re) => re.test(text))
}

const BLOCK_START = /^\s*([-*+]\s|\d+[.)]\s|#{1,6}\s|>|```|\||[-*_]{3,}\s*$)/

// In markdown a single newline inside a paragraph is a soft break that
// renders as a space — but people pasting text expect their lines to stay
// lines. Turn single newlines between plain lines into paragraph breaks,
// leaving fenced code, lists and other block syntax alone.
export function splitSoftBreaks(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let inFence = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    out.push(line)
    if (/^\s*```/.test(line)) inFence = !inFence
    if (inFence) continue
    const next = lines[i + 1]
    if (next === undefined) continue
    const plain = (l: string) => l.trim() !== '' && !BLOCK_START.test(l) && !/^\s/.test(l)
    if (plain(line) && plain(next) && !/(\s{2}|\\)$/.test(line)) out.push('')
  }
  return out.join('\n')
}

// ---- rich HTML from other apps ---------------------------------------------
// Docs, Word, Apple Notes, Slack, Gmail and the like put structure into the
// clipboard as styling rather than markup: <br>-separated lines, bold spans,
// big-font "headings", "•" bullets. Left alone, that pastes as one long
// paragraph. This rewrites it into the blocks the editor has.

const BULLET = /^\s*[•·◦▪▫●○■□–—*-]\s+/
const NUMBERED = /^\s*(\d{1,3}|[a-zA-Z])[.)]\s+/
const BLOCKS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'BLOCKQUOTE', 'PRE', 'TABLE', 'TR', 'TD', 'TH', 'HR', 'IMG', 'FIGURE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER'])

function unwrap(el: Element) {
  el.replaceWith(...Array.from(el.childNodes))
}

function rename(el: Element, tag: string): Element {
  const next = el.ownerDocument.createElement(tag)
  next.append(...Array.from(el.childNodes))
  el.replaceWith(next)
  return next
}

function fontPx(style: CSSStyleDeclaration): number {
  const m = /^([\d.]+)(px|pt)$/.exec(style.fontSize.trim())
  if (!m) return 0
  return m[2] === 'pt' ? Number(m[1]) * (4 / 3) : Number(m[1])
}

const hasBlockChild = (el: Element) => Array.from(el.children).some((c) => BLOCKS.has(c.tagName))

// The one element wrapping all of a block's text, if any (for "is this line
// entirely bold / big").
function soleWrapper(block: Element): Element | null {
  const text = block.textContent?.trim() ?? ''
  if (!text) return null
  let cur: Element = block
  for (;;) {
    const kids = Array.from(cur.childNodes).filter((n) => n.nodeType !== 3 || n.textContent!.trim())
    if (kids.length !== 1 || kids[0].nodeType !== 1) return cur === block ? null : cur
    cur = kids[0] as Element
    if (cur.tagName === 'BR') return null
  }
}

function isAllBold(block: Element): boolean {
  for (let el = soleWrapper(block); el && el !== block; el = el.parentElement) {
    if (el.tagName === 'B' || el.tagName === 'STRONG') return true
  }
  return false
}

export function normalizePastedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const body = doc.body

  for (const el of Array.from(body.querySelectorAll('style, meta, link, script, title'))) el.remove()
  for (const el of Array.from(body.getElementsByTagName('*'))) {
    if (el.tagName.includes(':')) unwrap(el) // Word's <o:p>
  }
  // Google Docs wraps the whole selection in <b style="font-weight:normal">.
  for (const el of Array.from(body.querySelectorAll('b[id^="docs-internal-guid"]'))) unwrap(el)
  // Word list markers: <span style="mso-list:Ignore">·</span>
  for (const el of Array.from(body.querySelectorAll('[style*="mso-list"]'))) {
    if (!/mso-list:\s*ignore/i.test(el.getAttribute('style') ?? '')) continue
    const marker = el.textContent?.trim() ?? ''
    el.replaceWith(doc.createTextNode(/^(\d{1,3}|[a-zA-Z])[.)]$/.test(marker) ? `${marker} ` : '• '))
  }

  // Lines inside one block (<br>, or <div> per line) become separate blocks.
  for (const block of Array.from(body.querySelectorAll('p, div'))) {
    if (hasBlockChild(block) || !block.querySelector('br')) continue
    const parts: Node[][] = [[]]
    for (const n of Array.from(block.childNodes)) {
      if (n.nodeName === 'BR') parts.push([])
      else parts[parts.length - 1].push(n)
    }
    const lines = parts.filter((p) => p.some((n) => n.textContent?.trim() || n.nodeName === 'IMG'))
    if (lines.length < 2 && parts.length < 3) continue
    block.replaceWith(
      ...lines.map((nodes) => {
        const p = doc.createElement('p')
        p.append(...nodes)
        return p
      }),
    )
  }
  for (const div of Array.from(body.querySelectorAll('div'))) {
    if (hasBlockChild(div)) continue
    if (!div.textContent?.trim() && !div.querySelector('img')) div.remove()
    else rename(div, 'p')
  }

  // Big-font lines read as headings.
  for (const p of Array.from(body.querySelectorAll('p'))) {
    const text = p.textContent?.trim() ?? ''
    if (!text || text.length > 120) continue
    let px = fontPx((p as HTMLElement).style)
    for (let el = soleWrapper(p); el && el !== p; el = el.parentElement) {
      px = Math.max(px, fontPx((el as HTMLElement).style))
    }
    if (px >= 22) rename(p, 'h2')
    else if (px >= 17) rename(p, 'h3')
  }

  // Styled spans become marks.
  for (const span of Array.from(body.querySelectorAll('span, font'))) {
    const st = (span as HTMLElement).style
    let inner: Node[] = Array.from(span.childNodes)
    const wrap = (tag: string) => {
      const el = doc.createElement(tag)
      el.append(...inner)
      inner = [el]
    }
    const weight = st.fontWeight
    if (weight === 'bold' || weight === 'bolder' || Number(weight) >= 600) wrap('strong')
    if (st.fontStyle === 'italic') wrap('em')
    if (/line-through/.test(st.textDecoration || st.textDecorationLine || '')) wrap('s')
    span.replaceWith(...inner)
  }

  // Heading levels: the note title is the page's h1.
  for (const h of Array.from(body.querySelectorAll('h1'))) rename(h, 'h2')
  for (const h of Array.from(body.querySelectorAll('h4, h5, h6'))) rename(h, 'h3')

  // "• item" / "1. item" paragraphs become real lists.
  const paras = Array.from(body.querySelectorAll('p'))
  for (let i = 0; i < paras.length; i++) {
    const kind = (p: Element) => {
      const t = p.textContent ?? ''
      return BULLET.test(t) ? 'ul' : NUMBERED.test(t) ? 'ol' : null
    }
    const k = paras[i].parentElement?.tagName === 'LI' ? null : kind(paras[i])
    if (!k) continue
    const list = doc.createElement(k)
    paras[i].before(list)
    while (i < paras.length && kind(paras[i]) === k && (list.lastElementChild === null || list.nextSibling === paras[i])) {
      const p = paras[i]
      stripMarker(p, k === 'ul' ? BULLET : NUMBERED)
      const li = doc.createElement('li')
      li.append(p)
      list.append(li)
      i++
    }
    i--
  }

  // A short, entirely bold line that introduces more text is a heading.
  for (const p of Array.from(body.querySelectorAll('p'))) {
    if (p.parentElement !== body || !p.nextElementSibling) continue
    const text = p.textContent?.trim() ?? ''
    if (text.length > 80 || /[.!?;,]$/.test(text) || !isAllBold(p)) continue
    const h = rename(p, 'h3')
    for (const b of Array.from(h.querySelectorAll('b, strong'))) unwrap(b)
  }

  for (const el of Array.from(body.querySelectorAll('[style], [class]'))) {
    el.removeAttribute('style')
    el.removeAttribute('class')
  }
  return body.innerHTML
}

// Drop the leading "• " / "1. " from a paragraph's first text node.
function stripMarker(p: Element, re: RegExp) {
  const walker = p.ownerDocument.createTreeWalker(p, NodeFilter.SHOW_TEXT)
  let text = ''
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    text += n.textContent
    if (!text.trim()) continue
    n.textContent = n.textContent!.replace(re, '')
    return
  }
}

// Plain text with "•" bullets (PDFs, chat apps): written as markdown lists so
// the markdown path picks them up.
export function bulletsToMarkdown(text: string): string {
  return text.replace(/^([ \t]*)[•·◦▪●○■–]\s+/gm, '$1- ')
}
