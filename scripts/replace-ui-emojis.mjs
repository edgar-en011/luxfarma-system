/**
 * Codemod: emojis funcionales → <UiIcon />.
 * Uso: node scripts/replace-ui-emojis.mjs <file.jsx> ...
 *
 * - En JSX (entre > y <): emoji solo o emoji+texto → UiIcon
 * - En strings de alerta (mostrarAlerta / setAlerta / mensaje): quita emoji decorativo inicial
 * - No toca lógica ni nombres de variables
 */
import fs from 'fs';
import path from 'path';

const EMOJI_ICON = {
  '🔍': 'Search',
  '✏️': 'Pencil',
  '🗑️': 'Trash2',
  '⚙️': 'Settings',
  '✅': 'CheckCircle2',
  '❌': 'XCircle',
  '🚫': 'Ban',
  '⚠️': 'AlertTriangle',
  '📦': 'Package',
  '🏷️': 'Tags',
  '📈': 'TrendingUp',
  '📉': 'TrendingDown',
  '💰': 'Wallet',
  '💵': 'Banknote',
  '💳': 'CreditCard',
  '🧾': 'Receipt',
  '📊': 'BarChart3',
  '👥': 'Users',
  '👤': 'User',
  '📄': 'FileText',
  '📋': 'ClipboardList',
  '🏢': 'Building2',
  '🏭': 'Factory',
  '🧪': 'FlaskConical',
  '🔄': 'RefreshCw',
  '➕': 'Plus',
  '➖': 'Minus',
  '⬇️': 'Download',
  '↓': 'Download',
  '⬆️': 'Upload',
  '📤': 'Upload',
  '📥': 'Download',
  '🖨️': 'Printer',
  '🔒': 'Lock',
  '🔑': 'Key',
  '⏳': 'Loader',
  '⏱️': 'Timer',
  '📅': 'Calendar',
  '📆': 'CalendarDays',
  '💊': 'Pill',
  '💉': 'Syringe',
  '🛒': 'ShoppingCart',
  '🛍️': 'ShoppingBag',
  '🏦': 'Landmark',
  '🚨': 'Siren',
  '🔔': 'Bell',
  '💡': 'Lightbulb',
  '📝': 'NotebookPen',
  '📌': 'Pin',
  '🔗': 'Link',
  '📎': 'Paperclip',
  '🧩': 'Puzzle',
  '⭐': 'Star',
  '🔥': 'Flame',
  '💬': 'MessageSquare',
  '🛠️': 'Wrench',
  '🔧': 'Wrench',
  '⚡': 'Zap',
  '🎯': 'Target',
  '📂': 'FolderOpen',
  '📁': 'Folder',
  '🔖': 'Bookmark',
  '✖️': 'X',
  '✔': 'Check',
  '✓': 'Check',
  '❗': 'AlertCircle',
  '❓': 'HelpCircle',
  '▾': 'ChevronDown',
  '▴': 'ChevronUp',
  '✕': 'X',
  '×': 'X',
  '💾': 'Save',
  '👁️': 'Eye',
  '👁': 'Eye',
  '🎁': 'Gift',
  '🔁': 'RefreshCw',
  'ℹ️': 'Info',
  'ℹ': 'Info',
  '⚠': 'AlertTriangle',
};

const EMOJI_CLASS = Object.keys(EMOJI_ICON)
  .sort((a, b) => b.length - a.length)
  .map((e) => e.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');

const emojiRe = new RegExp(`(?:${EMOJI_CLASS})`, 'gu');

function iconJsx(name, size = 16) {
  return `<UiIcon name="${name}" size={${size}} />`;
}

function stripLeadingEmojiFromString(strLiteral) {
  // '✅ foo' / "✅ foo" / `✅ foo`
  return strLiteral.replace(
    new RegExp(`^([\`'"'])(?:${EMOJI_CLASS})\\uFE0F?\\s*`),
    '$1'
  );
}

function transformJsxText(text) {
  // Solo emoji (con FE0F opcional y espacios)
  const only = text.match(new RegExp(`^\\s*(${EMOJI_CLASS})\\uFE0F?\\s*$`, 'u'));
  if (only) {
    const name = EMOJI_ICON[only[1]];
    return iconJsx(name, 16);
  }
  // Emoji al inicio + resto de texto
  const lead = text.match(new RegExp(`^\\s*(${EMOJI_CLASS})\\uFE0F?\\s+([\\s\\S]+)$`, 'u'));
  if (lead) {
    const name = EMOJI_ICON[lead[1]];
    const rest = lead[2];
    return `${iconJsx(name, 15)} ${rest}`;
  }
  return text;
}

function processSource(src) {
  let out = '';
  let i = 0;
  let changed = false;

  while (i < src.length) {
    // String literals ' " `
    const q = src[i];
    if (q === "'" || q === '"' || q === '`') {
      let j = i + 1;
      let esc = false;
      while (j < src.length) {
        const c = src[j];
        if (esc) { esc = false; j++; continue; }
        if (c === '\\') { esc = true; j++; continue; }
        if (c === q) { j++; break; }
        // template ${ }
        if (q === '`' && c === '$' && src[j + 1] === '{') {
          // leave as-is until closing — skip nested for simplicity: find matching }
          j += 2;
          let depth = 1;
          while (j < src.length && depth) {
            if (src[j] === '{') depth++;
            else if (src[j] === '}') depth--;
            j++;
          }
          continue;
        }
        j++;
      }
      let lit = src.slice(i, j);
      // Solo limpiar strings que parecen mensajes (alertas / confirmaciones)
      if (/mostrarAlerta|setAlerta|mensaje|title=|texto|confirm|Alerta|success|error|warning/i.test(src.slice(Math.max(0, i - 80), i))
        || /^(?:'|")(?:✅|❌|⚠️|🗑️|📦|💡|🔄)/u.test(lit)) {
        const cleaned = stripLeadingEmojiFromString(lit);
        if (cleaned !== lit) { lit = cleaned; changed = true; }
      }
      out += lit;
      i = j;
      continue;
    }

    // JSX text node: >....<
    if (src[i] === '>') {
      // look ahead for text until <
      let j = i + 1;
      while (j < src.length && src[j] !== '<' && src[j] !== '{') {
        // stop if we hit another tag quickly with only whitespace? keep scanning
        j++;
      }
      if (j < src.length && src[j] === '<' && j > i + 1) {
        const inner = src.slice(i + 1, j);
        // Only transform if it contains emoji and looks like text (not `>` of => or generics)
        if (emojiRe.test(inner) && !inner.includes('\n\n')) {
          emojiRe.lastIndex = 0;
          // Avoid transforming if looks like HTML comment remnant or code
          if (!/[;=]/.test(inner) || emojiRe.test(inner.trim())) {
            const transformed = transformJsxText(inner);
            if (transformed !== inner) {
              out += '>' + transformed;
              i = j;
              changed = true;
              continue;
            }
          }
        }
      }
      out += '>';
      i++;
      continue;
    }

    out += src[i];
    i++;
  }

  return { src: out, changed };
}

function ensureImport(src, filePath) {
  if (/import\s+UiIcon\s+from\s+['"]/.test(src)) return src;
  let importPath = "import UiIcon from '../../components/UiIcon';";
  if (filePath.includes(`${path.sep}components${path.sep}`) || filePath.includes('/components/')) {
    importPath = "import UiIcon from './UiIcon';";
  } else if (filePath.includes(`${path.sep}layouts${path.sep}`) || filePath.includes('/layouts/')) {
    importPath = "import UiIcon from '../components/UiIcon';";
  }
  const importRe = /^import .+;$/gm;
  let last = null;
  let m;
  while ((m = importRe.exec(src))) last = m;
  if (!last) return `${importPath}\n${src}`;
  const idx = last.index + last[0].length;
  return `${src.slice(0, idx)}\n${importPath}${src.slice(idx)}`;
}

let filesChanged = 0;
for (const file of process.argv.slice(2)) {
  const abs = path.resolve(file);
  if (!fs.existsSync(abs)) { console.error('missing', file); continue; }
  const before = fs.readFileSync(abs, 'utf8');
  let { src, changed } = processSource(before);
  // Ternaries with chevrons
  const chev = src.replace(
    /(\?) '▴' (:) '▾'/g,
    '$1 <UiIcon name="ChevronUp" size={14} /> $2 <UiIcon name="ChevronDown" size={14} />'
  );
  if (chev !== src) { src = chev; changed = true; }

  // Forzar import si ya hay <UiIcon> sin import (corrige corridas previas rotas)
  const needsImport = /<UiIcon\b/.test(src) && !/import\s+UiIcon\s+from\s+['"]/.test(src);
  if (!changed && !needsImport) {
    console.log(`-- ${file}`);
    continue;
  }
  src = ensureImport(src, abs);
  fs.writeFileSync(abs, src);
  filesChanged += 1;
  const beforeN = (before.match(/\p{Extended_Pictographic}/gu) || []).length;
  const afterN = (src.match(/\p{Extended_Pictographic}/gu) || []).length;
  console.log(`OK ${file} emoji ${beforeN}→${afterN}`);
}
console.log(`DONE changed=${filesChanged}`);
