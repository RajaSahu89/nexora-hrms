import type { Response } from 'express';
import PDFDocument from 'pdfkit';
import type { Column } from '../utils/csv';

const money = (n: unknown, cur: string) => `${cur} ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function streamPayslip(res: Response, p: any, emp: any, company: any) {
  const cur = company.currency || 'INR';
  const doc = new PDFDocument({ size: 'A4', margin: 50 });
  const period = new Date(Date.UTC(p.year, p.month - 1, 1)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="payslip-${emp.employeeCode}-${p.year}-${String(p.month).padStart(2, '0')}.pdf"`);
  doc.pipe(res);
  doc.fontSize(20).fillColor('#101820').text(company.name || 'Company', { align: 'left' });
  doc.fontSize(10).fillColor('#687078').text(company.address || '');
  doc.moveDown().fontSize(14).fillColor('#101820').text(`Payslip - ${period}`);
  if (p.status === 'ESTIMATED') doc.fontSize(10).fillColor('#E4002B').text('ESTIMATED - NOT FINALIZED. Figures may change.');
  doc.moveDown().fontSize(10).fillColor('#202124');
  doc.text(`Employee: ${emp.firstName} ${emp.lastName} (${emp.employeeCode})`);
  doc.text(`Department: ${emp.department?.name ?? '-'}   Designation: ${emp.designation?.title ?? '-'}`);
  doc.text(`Status: ${p.status}`);
  doc.moveDown();
  const rows: [string, unknown][] = [
    ['Basic salary', p.basicSalary], ['HRA', p.hra], ['Allowances', p.allowances], ['Bonuses', p.bonuses], ['Overtime pay', p.overtimePay],
    ['Gross pay', p.grossPay], ['Deductions (incl. loss of pay)', p.deductions], ['Tax', p.tax], ['NET PAY', p.netPay],
  ];
  for (const [label, val] of rows) {
    const bold = ['Gross pay', 'NET PAY'].includes(label);
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').text(label, 50, doc.y, { continued: true, width: 300 });
    doc.text(money(val, cur), { align: 'right' });
  }
  doc.moveDown(2).font('Helvetica').fontSize(8).fillColor('#687078').text('This is a system-generated payslip.');
  doc.end();
}

export function streamTablePdf(res: Response, title: string, columns: Column[], rows: Record<string, unknown>[], filename: string) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  doc.pipe(res);
  const width = doc.page.width - 72;
  const colW = width / columns.length;
  const header = () => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#101820');
    const y = doc.y;
    columns.forEach((c, i) => doc.text(c.label, 36 + i * colW, y, { width: colW - 4, lineBreak: false, ellipsis: true }));
    doc.moveDown(0.8).font('Helvetica');
  };
  doc.fontSize(16).fillColor('#101820').text(title);
  doc.fontSize(8).fillColor('#687078').text(`Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} - ${rows.length} row(s)`);
  doc.moveDown();
  header();
  doc.fontSize(7.5).fillColor('#202124');
  for (const r of rows) {
    if (doc.y > doc.page.height - 60) { doc.addPage(); header(); doc.fontSize(7.5).fillColor('#202124'); }
    const y = doc.y;
    columns.forEach((c, i) => {
      const v = r[c.key];
      doc.text(v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v), 36 + i * colW, y, { width: colW - 4, lineBreak: false, ellipsis: true });
    });
    doc.moveDown(0.7);
  }
  doc.end();
}
