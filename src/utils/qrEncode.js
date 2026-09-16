/**
 * QR byte-mode (ISO/IEC 18004), ECC M, versiones 1–10.
 * Suficiente para la cadena SUNAT (~100 caracteres) que va en el ticket.
 */

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
;(function initGf() {
  let x = 1
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255]
})()

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0
  return EXP[LOG[a] + LOG[b]]
}

/** [n1, d1, n2, d2, ec] — bloques grupo1 / grupo2 y ECC por bloque. Nivel M. */
const ECC_M = [
  null,
  [1, 16, 0, 0, 10],
  [1, 28, 0, 0, 16],
  [1, 44, 0, 0, 26],
  [2, 32, 0, 0, 18],
  [2, 43, 0, 0, 24],
  [4, 27, 0, 0, 16],
  [4, 31, 0, 0, 18],
  [2, 38, 2, 39, 22],
  [3, 36, 2, 37, 22],
  [4, 43, 1, 44, 26],
]

const ALIGN = [
  [],
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
]

function rsGenerator(ecLen) {
  let g = [1]
  for (let i = 0; i < ecLen; i += 1) {
    const next = new Array(g.length + 1).fill(0)
    for (let j = 0; j < g.length; j += 1) {
      next[j] ^= g[j]
      next[j + 1] ^= gfMul(g[j], EXP[i])
    }
    g = next
  }
  return g
}

function rsEncode(data, ecLen) {
  const gen = rsGenerator(ecLen)
  const res = data.concat(new Array(ecLen).fill(0))
  for (let i = 0; i < data.length; i += 1) {
    const coef = res[i]
    if (coef === 0) continue
    for (let j = 0; j < gen.length; j += 1) {
      res[i + j] ^= gfMul(gen[j], coef)
    }
  }
  return res.slice(data.length)
}

function toBytes(str) {
  if (typeof TextEncoder !== 'undefined') {
    return Array.from(new TextEncoder().encode(str))
  }
  const bytes = []
  for (let i = 0; i < str.length; i += 1) bytes.push(str.charCodeAt(i) & 0xff)
  return bytes
}

function bitBuffer() {
  const bits = []
  return {
    push(val, len) {
      for (let i = len - 1; i >= 0; i -= 1) bits.push((val >>> i) & 1)
    },
    toCodewords() {
      const out = []
      for (let i = 0; i < bits.length; i += 8) {
        let b = 0
        for (let j = 0; j < 8; j += 1) b = (b << 1) | (bits[i + j] || 0)
        out.push(b)
      }
      return out
    },
    get length() {
      return bits.length
    },
  }
}

function dataCapacity(version) {
  const [n1, d1, n2, d2] = ECC_M[version]
  return n1 * d1 + n2 * d2
}

function countBits(version) {
  return version <= 9 ? 8 : 16
}

function chooseVersion(byteLen) {
  for (let v = 1; v <= 10; v += 1) {
    const capBits = dataCapacity(v) * 8
    const need = 4 + countBits(v) + byteLen * 8 + 4
    if (need <= capBits) return v
  }
  throw new Error('Texto demasiado largo para QR del ticket')
}

function buildDataCodewords(bytes, version) {
  const cap = dataCapacity(version)
  const bb = bitBuffer()
  bb.push(0b0100, 4)
  bb.push(bytes.length, countBits(version))
  for (const b of bytes) bb.push(b, 8)
  const capBits = cap * 8
  const term = Math.min(4, capBits - bb.length)
  if (term > 0) bb.push(0, term)
  while (bb.length % 8 !== 0) bb.push(0, 1)
  const cw = bb.toCodewords()
  const pads = [0xec, 0x11]
  let p = 0
  while (cw.length < cap) {
    cw.push(pads[p % 2])
    p += 1
  }
  return cw
}

function interleave(dataCw, version) {
  const [n1, d1, n2, d2, ec] = ECC_M[version]
  const blocks = []
  let offset = 0
  for (let i = 0; i < n1; i += 1) {
    const data = dataCw.slice(offset, offset + d1)
    offset += d1
    blocks.push({ data, ecc: rsEncode(data, ec) })
  }
  for (let i = 0; i < n2; i += 1) {
    const data = dataCw.slice(offset, offset + d2)
    offset += d2
    blocks.push({ data, ecc: rsEncode(data, ec) })
  }
  const maxD = Math.max(d1, d2)
  const out = []
  for (let i = 0; i < maxD; i += 1) {
    for (const b of blocks) if (i < b.data.length) out.push(b.data[i])
  }
  for (let i = 0; i < ec; i += 1) {
    for (const b of blocks) out.push(b.ecc[i])
  }
  return out
}

function matrixSize(version) {
  return 21 + 4 * (version - 1)
}

function alignmentOverlapsFinder(r, c, size) {
  const finders = [[0, 0], [0, size - 7], [size - 7, 0]]
  return finders.some(([fr, fc]) => (
    r - 2 < fr + 7 && r + 3 > fr && c - 2 < fc + 7 && c + 3 > fc
  ))
}

function setFinder(mod, reserved, size) {
  const draw = (r0, c0) => {
    for (let r = 0; r < 7; r += 1) {
      for (let c = 0; c < 7; c += 1) {
        const on = r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)
        mod[r0 + r][c0 + c] = on
        reserved[r0 + r][c0 + c] = true
      }
    }
  }
  draw(0, 0)
  draw(0, size - 7)
  draw(size - 7, 0)
}

function setSeparators(reserved, size) {
  const mark = (r, c) => {
    if (r >= 0 && r < size && c >= 0 && c < size) reserved[r][c] = true
  }
  for (let i = 0; i < 8; i += 1) {
    mark(7, i)
    mark(i, 7)
    mark(7, size - 8 + i)
    mark(i, size - 8)
    mark(size - 8, i)
    mark(size - 8 + i, 7)
  }
}

function setTiming(mod, reserved, size) {
  for (let i = 8; i < size - 8; i += 1) {
    mod[6][i] = i % 2 === 0
    mod[i][6] = i % 2 === 0
    reserved[6][i] = true
    reserved[i][6] = true
  }
}

function setAlignment(mod, reserved, version) {
  const pos = ALIGN[version]
  const size = matrixSize(version)
  const pattern = [
    [1, 1, 1, 1, 1],
    [1, 0, 0, 0, 1],
    [1, 0, 1, 0, 1],
    [1, 0, 0, 0, 1],
    [1, 1, 1, 1, 1],
  ]
  for (const r of pos) {
    for (const c of pos) {
      if (alignmentOverlapsFinder(r, c, size)) continue
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          const rr = r + dr
          const cc = c + dc
          mod[rr][cc] = pattern[dr + 2][dc + 2] === 1
          reserved[rr][cc] = true
        }
      }
    }
  }
}

function setDarkAndFormatReserve(reserved, size) {
  reserved[size - 8][8] = true
  for (let i = 0; i < 9; i += 1) {
    reserved[8][i] = true
    reserved[i][8] = true
  }
  for (let i = 0; i < 8; i += 1) {
    reserved[8][size - 8 + i] = true
    reserved[size - 8 + i][8] = true
  }
}

function maskFn(mask) {
  return (r, c) => {
    switch (mask) {
      case 0: return ((r + c) % 2) === 0
      case 1: return (r % 2) === 0
      case 2: return (c % 3) === 0
      case 3: return ((r + c) % 3) === 0
      case 4: return ((Math.floor(r / 2) + Math.floor(c / 3)) % 2) === 0
      case 5: return (((r * c) % 2) + ((r * c) % 3)) === 0
      case 6: return ((((r * c) % 2) + ((r * c) % 3)) % 2) === 0
      default: return ((((r + c) % 2) + ((r * c) % 3)) % 2) === 0
    }
  }
}

function placeData(mod, reserved, codewords, size) {
  const bits = []
  for (const w of codewords) {
    for (let i = 7; i >= 0; i -= 1) bits.push((w >>> i) & 1)
  }
  let bi = 0
  let upward = true
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1
    for (let i = 0; i < size; i += 1) {
      const row = upward ? size - 1 - i : i
      for (const dc of [0, -1]) {
        const c = col + dc
        if (reserved[row][c]) continue
        mod[row][c] = bi < bits.length ? bits[bi] === 1 : false
        bi += 1
      }
    }
    upward = !upward
  }
}

function cloneMod(mod) {
  return mod.map((row) => row.slice())
}

function applyMask(mod, reserved, mask, size) {
  const fn = maskFn(mask)
  const out = cloneMod(mod)
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (!reserved[r][c] && fn(r, c)) out[r][c] = !out[r][c]
    }
  }
  return out
}

function bchFormat(data) {
  let d = data << 10
  const gen = 0x537
  for (let i = 14; i >= 10; i -= 1) {
    if ((d >>> i) & 1) d ^= gen << (i - 10)
  }
  return ((data << 10) | d) ^ 0x5412
}

function setFormat(mod, size, mask) {
  // ECC M = 00. Bit 0 = MSB del BCH de 15 bits.
  const bits = bchFormat((0b00 << 3) | mask)
  const bitAt = (i) => ((bits >>> (14 - i)) & 1) === 1
  const topLeft = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ]
  topLeft.forEach(([r, c], i) => { mod[r][c] = bitAt(i) })
  for (let i = 0; i < 8; i += 1) mod[8][size - 1 - i] = bitAt(i)
  for (let i = 8; i < 15; i += 1) mod[size - 15 + i][8] = bitAt(i)
  mod[size - 8][8] = true
}

function penalty(mod, size) {
  let score = 0
  for (let r = 0; r < size; r += 1) {
    let run = 1
    for (let c = 1; c <= size; c += 1) {
      if (c < size && mod[r][c] === mod[r][c - 1]) run += 1
      else {
        if (run >= 5) score += 3 + (run - 5)
        run = 1
      }
    }
  }
  for (let c = 0; c < size; c += 1) {
    let run = 1
    for (let r = 1; r <= size; r += 1) {
      if (r < size && mod[r][c] === mod[r - 1][c]) run += 1
      else {
        if (run >= 5) score += 3 + (run - 5)
        run = 1
      }
    }
  }
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = mod[r][c]
      if (v === mod[r][c + 1] && v === mod[r + 1][c] && v === mod[r + 1][c + 1]) score += 3
    }
  }
  const finder = [1, 0, 1, 1, 1, 0, 1]
  const check = (line) => {
    let s = 0
    for (let i = 0; i <= line.length - 7; i += 1) {
      let ok = true
      for (let j = 0; j < 7; j += 1) if (line[i + j] !== finder[j]) { ok = false; break }
      if (!ok) continue
      const left = i >= 4 && line.slice(i - 4, i).every((x) => x === 0)
      const right = i + 11 <= line.length && line.slice(i + 7, i + 11).every((x) => x === 0)
      if (left || right) s += 40
    }
    return s
  }
  for (let r = 0; r < size; r += 1) score += check(mod[r].map((x) => (x ? 1 : 0)))
  for (let c = 0; c < size; c += 1) {
    const col = []
    for (let r = 0; r < size; r += 1) col.push(mod[r][c] ? 1 : 0)
    score += check(col)
  }
  let dark = 0
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) if (mod[r][c]) dark += 1
  }
  const pct = (dark * 100) / (size * size)
  score += Math.floor(Math.abs(pct - 50) / 5) * 10
  return score
}

function setVersionInfo(mod, reserved, version, size) {
  if (version < 7) return
  let d = version << 12
  const gen = 0x1f25
  for (let i = 17; i >= 12; i -= 1) {
    if ((d >>> i) & 1) d ^= gen << (i - 12)
  }
  const bits = (version << 12) | d
  let k = 0
  for (let r = 0; r < 6; r += 1) {
    for (let c = 0; c < 3; c += 1) {
      const on = ((bits >>> k) & 1) === 1
      mod[r][size - 11 + c] = on
      reserved[r][size - 11 + c] = true
      mod[size - 11 + c][r] = on
      reserved[size - 11 + c][r] = true
      k += 1
    }
  }
}

/**
 * @param {string} text
 * @returns {boolean[][]} módulos (true = negro), sin borde
 */
export function encodeQr(text) {
  const bytes = toBytes(String(text || ''))
  const version = chooseVersion(bytes.length)
  const size = matrixSize(version)
  const dataCw = buildDataCodewords(bytes, version)
  const codewords = interleave(dataCw, version)

  const mod = Array.from({ length: size }, () => Array(size).fill(false))
  const reserved = Array.from({ length: size }, () => Array(size).fill(false))

  setFinder(mod, reserved, size)
  setSeparators(reserved, size)
  setAlignment(mod, reserved, version)
  setTiming(mod, reserved, size)
  setDarkAndFormatReserve(reserved, size)
  setVersionInfo(mod, reserved, version, size)
  placeData(mod, reserved, codewords, size)

  let best = null
  let bestScore = Infinity
  for (let mask = 0; mask < 8; mask += 1) {
    const masked = applyMask(mod, reserved, mask, size)
    setFormat(masked, size, mask)
    const score = penalty(masked, size)
    if (score < bestScore) {
      bestScore = score
      best = masked
    }
  }
  return best
}

export function qrToSvg(text, { moduleSize = 4, border = 2 } = {}) {
  const mods = encodeQr(text)
  const n = mods.length
  const dim = (n + border * 2) * moduleSize
  const parts = []
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if (!mods[y][x]) continue
      parts.push(`M${(x + border) * moduleSize},${(y + border) * moduleSize}h${moduleSize}v${moduleSize}h-${moduleSize}z`)
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim}" height="${dim}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path fill="#000" d="${parts.join('')}"/></svg>`
}
