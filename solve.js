// Fast drop-in for csv-reader 1.0.0 (make.fun), written from scratch for
// csv-reader-speed-01-run-20261121. It returns exactly csv-reader 1.0.0's
// answer for every input, faster: records whose line holds no quote and no
// stray CR are split with the engine's native split, and every other field is
// scanned with native indexOf / regex jumps instead of one character at a time.
//
// Semantics (competition rules): the text is read once, left to right; a
// U+FEFF at its very start is dropped; a record ends at LF or CRLF; a line
// left with no characters is no record; outside quotes a CR not followed by LF
// is dropped (stray_cr); a field that opens with a quote runs to the next
// quote that is not doubled, "" inside it is one quote, each CRLF or lone CR
// inside it is read as LF; what follows its closing quote, up to the next
// comma or line break, is appended as it stands (quote_junk, when the field
// ends); a quote that never closes is a literal character and the text after
// it is read again as unquoted (unterminated_quote); a quote inside an
// unquoted field is a literal character; fields stay strings, never trimmed or
// converted; columns is the first record when header is true, else null; rows
// hold the records after it, each padded with empty strings (short_row, with
// fields: its field count) or cut (long_row, with extra: the cut fields) to
// the first record's width; each error is {code, line, row}, in the order met,
// a record's short_row or long_row when it ends: line the 1-based line its
// record starts on, counting every LF, CRLF and lone CR inside quotes, and row
// its record's index in rows, null for the header.

const RE_FIELD = /[,\r\n]/g; // next end of an unquoted field
const RE_QUOTED = /["\r\n]/g; // next special character inside a quoted field

const COMMA = 0;
const BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input, {text, header}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const rows = [];
  const errors = [];
  let columns = null;
  let width = -1;
  let pos = 0; // next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header). Errors of the record carry these.
  let recordLine = 1;
  let recordRow = null;

  function pushError(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads an unquoted field onto `start` up to the next comma or line break:
  // a CR not followed by LF is dropped (stray_cr). Returns the field, how it
  // ended, and how many characters were kept onto it.
  function readUnquoted(start) {
    let value = start;
    const startLen = start.length;
    while (pos < len) {
      RE_FIELD.lastIndex = pos;
      const m = RE_FIELD.exec(text);
      const stop = m ? m.index : len;
      if (stop > pos) {
        value += text.slice(pos, stop);
        pos = stop;
      }
      if (!m) return { value, ended: END, added: value.length - startLen };
      const c = m[0];
      if (c === ',') {
        pos += 1;
        return { value, ended: COMMA, added: value.length - startLen };
      }
      if (c === '\n') {
        pos += 1;
        line += 1;
        return { value, ended: BREAK, added: value.length - startLen };
      }
      // c === '\r': a CRLF ends the field, a lone CR is dropped.
      if (text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        return { value, ended: BREAK, added: value.length - startLen };
      }
      pushError('stray_cr');
      pos += 1;
    }
    return { value, ended: END, added: value.length - startLen };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    pos += 1;
    let closed = false;
    while (pos < len) {
      RE_QUOTED.lastIndex = pos;
      const m = RE_QUOTED.exec(text);
      const stop = m ? m.index : len;
      if (stop > pos) {
        value += text.slice(pos, stop);
        pos = stop;
      }
      if (!m) break; // no more special characters: the quote never closes
      const c = m[0];
      if (c === '"') {
        if (text.charCodeAt(pos + 1) === 34) {
          value += '"';
          pos += 2;
          continue;
        }
        pos += 1;
        closed = true;
        break;
      }
      if (c === '\r') {
        // CRLF and a lone CR inside quotes are each one LF.
        value += '\n';
        line += 1;
        pos += text.charCodeAt(pos + 1) === 10 ? 2 : 1;
        continue;
      }
      // c === '\n'
      value += '\n';
      line += 1;
      pos += 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text
      // after it is read again as unquoted.
      pos = open + 1;
      line = openLine;
      pushError('unterminated_quote');
      return readUnquoted('"');
    }
    if (pos >= len) return { value, ended: END, added: 0 };
    const c = text[pos];
    if (c === ',') {
      pos += 1;
      return { value, ended: COMMA, added: 0 };
    }
    if (c === '\n') {
      pos += 1;
      line += 1;
      return { value, ended: BREAK, added: 0 };
    }
    if (c === '\r' && text.charCodeAt(pos + 1) === 10) {
      pos += 2;
      line += 1;
      return { value, ended: BREAK, added: 0 };
    }
    // What follows the closing quote is appended as it stands, up to the
    // next comma or line break.
    const junk = readUnquoted(value);
    if (junk.added > 0) pushError('quote_junk');
    return junk;
  }

  // Reads one record the slow way, field by field. Returns its fields and
  // whether its last field opened with a quote.
  function readRecordSlow() {
    const fields = [];
    let quoted = false;
    let ended;
    do {
      quoted = text.charCodeAt(pos) === 34;
      const field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
      ended = field.ended;
    } while (ended === COMMA);
    return { fields, quoted };
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    let fields;
    let quoted = false;
    // Fast path: this record's line holds no quote and no stray CR, so the
    // whole line splits natively. A trailing CR right before the LF is the
    // line break itself (CRLF) and is stripped, never a stray CR.
    const lineEnd = text.indexOf('\n', pos);
    const end = lineEnd === -1 ? len : lineEnd;
    const quoteAt = text.indexOf('"', pos);
    if (quoteAt === -1 || quoteAt >= end) {
      const crAt = text.indexOf('\r', pos);
      const crlf = lineEnd !== -1 && end > pos && text.charCodeAt(end - 1) === 13;
      if (crAt === -1 || (crlf && crAt === end - 1)) {
        fields = text.slice(pos, crlf ? end - 1 : end).split(',');
        pos = lineEnd === -1 ? len : lineEnd + 1;
        if (lineEnd !== -1) line += 1;
      } else {
        const record = readRecordSlow();
        fields = record.fields;
        quoted = record.quoted;
      }
    } else {
      const record = readRecordSlow();
      fields = record.fields;
      quoted = record.quoted;
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
