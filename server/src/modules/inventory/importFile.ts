import ExcelJS from 'exceljs';
import { open } from 'yauzl';
import { readFile } from 'node:fs/promises';
import { ApiError } from '../../utils/errors.js';

export type ImportRecord = { rowNumber: number; values: string[]; error?: string };
const MAX_ROWS = 5001;
const MAX_COLUMNS = 30;
const MAX_EXPANDED = 25 * 1024 * 1024;

function parseCsv(content: string): ImportRecord[] {
  const records: ImportRecord[] = []; let values: string[] = []; let field = ''; let quoted = false; let closed = false; let line = 1; let rowNumber = 1;
  const endField = () => { values.push(field.trim()); field = ''; closed = false; if (values.length > MAX_COLUMNS) throw new ApiError(400, 'Too many columns in import'); };
  const endRow = () => { endField(); if (values.some(Boolean)) records.push({ rowNumber, values }); if (records.length > MAX_ROWS) throw new ApiError(400, 'Import may contain at most 5000 data rows'); values = []; rowNumber = line; };
  for (let i = 0; i < content.length; i++) {
    const char = content[i]!;
    if (quoted) { if (char === '"' && content[i + 1] === '"') { field += '"'; i++; } else if (char === '"') { quoted = false; closed = true; } else { field += char; if (char === '\n') line++; } }
    else if (char === ',') endField();
    else if (char === '\n' || char === '\r') { if (char === '\r' && content[i + 1] === '\n') i++; line++; endRow(); }
    else if (char === '"' && !field.trim() && !closed) { field = ''; quoted = true; }
    else if (char === '"' || (closed && !/\s/.test(char))) throw new ApiError(400, `Invalid CSV quoting near line ${line}`);
    else if (!closed) field += char;
  }
  if (quoted) throw new ApiError(400, 'CSV contains an unclosed quoted field');
  endRow(); return records;
}

// Validate and decompress each ZIP member before passing the bounded archive to ExcelJS.
function validateWorkbookArchive(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    open(filePath, { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true }, (openError, zip) => {
      if (openError || !zip) { reject(new ApiError(400, 'Invalid XLSX file')); return; }
      let done = false; let entries = 0; let total = 0; const names = new Set<string>();
      const fail = () => { if (!done) { done = true; zip.close(); reject(new ApiError(400, 'Invalid or oversized XLSX archive')); } };
      zip.on('error', fail);
      zip.on('end', () => { if (!done) { done = true; zip.close(); resolve(); } });
      zip.on('entry', (entry) => {
        const name = entry.fileName.toLowerCase();
        if (++entries > 1000 || names.has(name) || (entry.generalPurposeBitFlag & 1) !== 0 || entry.uncompressedSize > 10 * 1024 * 1024 || (total += entry.uncompressedSize) > MAX_EXPANDED || /^(xl\/(externallinks|embeddings|activex)\/|xl\/vbaproject\.bin$|xl\/connections\.xml$)/.test(name)) { fail(); return; }
        names.add(name);
        if (name.endsWith('/')) { zip.readEntry(); return; }
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError || !stream) { fail(); return; }
          stream.on('error', fail); stream.on('data', () => undefined); stream.on('end', () => { if (!done) zip.readEntry(); });
        });
      });
      zip.readEntry();
    });
  });
}

export async function readImportRecords(filePath: string, isXlsx: boolean): Promise<ImportRecord[]> {
  if (!isXlsx) {
    const raw = await readFile(filePath); if (raw.includes(0)) throw new ApiError(400, 'CSV file contains binary data');
    return parseCsv(raw.toString('utf8').replace(/^\uFEFF/, ''));
  }
  await validateWorkbookArchive(filePath);
  const workbook = new ExcelJS.Workbook();
  try { await workbook.xlsx.readFile(filePath); } catch { throw new ApiError(400, 'Unable to read XLSX workbook'); }
  if (workbook.worksheets.length !== 1) throw new ApiError(400, 'XLSX must contain exactly one worksheet');
  const sheet = workbook.worksheets[0]!;
  if (sheet.state !== 'visible' || sheet.model.merges?.length) throw new ApiError(400, 'XLSX worksheet must be visible and contain no merged cells');
  if (sheet.rowCount > MAX_ROWS || sheet.columnCount > MAX_COLUMNS) throw new ApiError(400, 'XLSX exceeds the 5000 row or 30 column limit');
  const records: ImportRecord[] = [];
  for (let index = 1; index <= sheet.rowCount; index++) {
    const row = sheet.getRow(index); const values: string[] = []; let error: string | undefined;
    for (let column = 1; column <= sheet.columnCount; column++) {
      const value = row.getCell(column).value;
      if (value == null) values.push('');
      else if (value instanceof Date && !Number.isNaN(value.getTime())) values.push(value.toISOString());
      else if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) values.push(String(value).trim());
      else { values.push(''); error = 'Use plain text, numbers or dates; formulas and links are not supported'; }
    }
    if (values.some(Boolean) || error) records.push({ rowNumber: index, values, error });
  }
  return records;
}
