import { Response } from 'express';
import PDFDocument from 'pdfkit';

export type Column = { key: string; label: string };

export function toCsv(rows: Record<string, any>[]) {
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const esc = (v: any) => {
    if (v == null) return '';
    let s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v);
    if (typeof v === 'string' && /^[=+\-@]/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return '\uFEFF' + [cols.map(esc).join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\r\n');
}

export function sendPdfTable(res: Response, title: string, rows: Record<string, any>[]) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${title.replace(/\W+/g, '-').toLowerCase()}.pdf"`);
  doc.pipe(res);
  doc.fontSize(16).text(title).fontSize(9).fillColor('#687078').text(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC  -  ${rows.length} rows`).fillColor('#202124').moveDown();
  const cols = rows.length ? Object.keys(rows[0]) : [];
  if (!cols.length) { doc.text('No data for the selected filters.'); return doc.end(); }
  const width = doc.page.width - 72, cw = width / cols.length;
  const line = (vals: string[], bold: boolean) => {
    if (doc.y > doc.page.height - 60) doc.addPage();
    const y = doc.y;
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(8);
    vals.forEach((v, i) => doc.text(v.length > 40 ? v.slice(0, 38) + '..' : v, 36 + i * cw, y, { width: cw - 4, lineBreak: false }));
    doc.y = y + 14;
    if (bold) doc.moveTo(36, doc.y - 2).lineTo(36 + width, doc.y - 2).strokeColor('#9CC6E0').stroke();
  };
  line(cols, true);
  rows.forEach((r) => line(cols.map((c) => (r[c] == null ? '' : r[c] instanceof Date ? r[c].toISOString().slice(0, 10) : String(r[c]))), false));
  doc.end();
}
