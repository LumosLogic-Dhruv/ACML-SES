import { PassThrough } from 'stream';
import PDFDocument from 'pdfkit';
import { pool } from './db';
import { config } from '../config';
import { sendEmail } from './mailer';

interface EmailLogRow {
  recipient: string;
  subject: string;
  status: string;
  delivered: boolean;
  bounced: boolean;
  sent_at: string;
}

function getDisplayStatus(row: EmailLogRow): string {
  if (row.bounced) return 'bounced';
  if (row.delivered) return 'delivered';
  if (row.status === 'sent') return 'sent';
  return 'failed';
}

function formatTimeIST(sentAt: string): string {
  return new Date(sentAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
}

function generateCsvBuffer(rows: EmailLogRow[]): Buffer {
  const header = '#,Recipient,Subject,Status,Delivered,Bounced,Time (IST)\n';
  const lines = rows.map((row, i) => {
    const status = getDisplayStatus(row);
    const time = formatTimeIST(row.sent_at);
    // Escape fields that might contain commas
    const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
    return `${i + 1},${escape(row.recipient)},${escape(row.subject)},${status},${row.delivered},${row.bounced},${escape(time)}`;
  });
  return Buffer.from(header + lines.join('\n'), 'utf-8');
}

function generatePdfBuffer(params: {
  rows: EmailLogRow[];
  clientName: string;
  period: string;
  total: number;
  delivered: number;
  bounced: number;
  failed: number;
  deliveryRate: string;
  bounceRate: string;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const pass = new PassThrough();
    const chunks: Buffer[] = [];

    pass.on('data', (chunk: Buffer) => chunks.push(chunk));
    pass.on('end', () => resolve(Buffer.concat(chunks)));
    pass.on('error', reject);

    doc.pipe(pass);

    const INDIGO = '#4F46E5';
    const INDIGO_LIGHT = '#EEF2FF';
    const GRAY = '#6B7280';
    const DARK = '#111827';
    const WHITE = '#FFFFFF';
    const GREEN = '#16A34A';
    const RED = '#DC2626';
    const ORANGE = '#D97706';
    const pageWidth = doc.page.width;
    const margin = 40;
    const contentWidth = pageWidth - margin * 2;

    let pageNum = 1;

    function addHeader() {
      // Header bar
      doc.rect(0, 0, pageWidth, 56).fill(INDIGO);
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(20)
        .text('LumosMails', margin, 17);
      const rightText = `Email Performance Report\n${params.clientName} | ${params.period}`;
      doc.fillColor(WHITE).font('Helvetica').fontSize(9)
        .text(rightText, margin, 12, { width: contentWidth, align: 'right' });
      doc.y = 70;
    }

    function addFooter() {
      const footerY = doc.page.height - 30;
      doc.rect(0, footerY - 8, pageWidth, 30).fill(INDIGO);
      doc.fillColor(WHITE).font('Helvetica').fontSize(8)
        .text(
          `LumosMails by LumosLogic | Confidential | Page ${pageNum}`,
          margin, footerY,
          { width: contentWidth, align: 'center' }
        );
    }

    addHeader();

    // Generated date
    const generatedDate = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    doc.fillColor(GRAY).font('Helvetica').fontSize(9)
      .text(`Generated: ${generatedDate} IST`, margin, doc.y, { align: 'right', width: contentWidth });
    doc.moveDown(0.8);

    // PERFORMANCE SUMMARY section label
    doc.fillColor(INDIGO).font('Helvetica-Bold').fontSize(11)
      .text('PERFORMANCE SUMMARY', margin, doc.y);
    doc.moveDown(0.5);

    // 4 stat boxes
    const boxW = (contentWidth - 12) / 4;
    const boxH = 64;
    const boxY = doc.y;

    const boxes = [
      { label: 'Total Sent', value: String(params.total), sub: '', color: INDIGO },
      { label: 'Delivered', value: String(params.delivered), sub: `${params.deliveryRate}% delivery rate`, color: GREEN },
      { label: 'Bounced', value: String(params.bounced), sub: `${params.bounceRate}% bounce rate`, color: RED },
      { label: 'Failed', value: String(params.failed), sub: '', color: ORANGE },
    ];

    boxes.forEach((box, i) => {
      const bx = margin + i * (boxW + 4);
      doc.rect(bx, boxY, boxW, boxH).fill(INDIGO_LIGHT);
      doc.rect(bx, boxY, 3, boxH).fill(box.color);
      doc.fillColor(DARK).font('Helvetica-Bold').fontSize(18)
        .text(box.value, bx + 8, boxY + 10, { width: boxW - 12 });
      doc.fillColor(GRAY).font('Helvetica').fontSize(8)
        .text(box.label, bx + 8, boxY + 34, { width: boxW - 12 });
      if (box.sub) {
        doc.fillColor(box.color).font('Helvetica').fontSize(7)
          .text(box.sub, bx + 8, boxY + 46, { width: boxW - 12 });
      }
    });

    doc.y = boxY + boxH + 10;

    // Summary banner
    const bannerY = doc.y;
    doc.rect(margin, bannerY, contentWidth, 28).fill(INDIGO);
    const bannerCols = [
      { label: 'Period', value: params.period },
      { label: 'Delivery Rate', value: `${params.deliveryRate}%` },
      { label: 'Bounce Rate', value: `${params.bounceRate}%` },
      { label: 'Success', value: `${params.delivered}/${params.total}` },
    ];
    const colW = contentWidth / 4;
    bannerCols.forEach((col, i) => {
      const cx = margin + i * colW;
      doc.fillColor(INDIGO_LIGHT).font('Helvetica').fontSize(7)
        .text(col.label, cx + 4, bannerY + 4, { width: colW - 8, align: 'center' });
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(9)
        .text(col.value, cx + 4, bannerY + 14, { width: colW - 8, align: 'center' });
    });

    doc.y = bannerY + 38;

    // EMAIL LOGS section heading
    doc.moveDown(0.5);
    doc.fillColor(INDIGO).font('Helvetica-Bold').fontSize(11)
      .text('EMAIL LOGS', margin, doc.y);
    doc.moveDown(0.4);

    // Table header
    const colDefs = [
      { label: '#', w: 24 },
      { label: 'Recipient', w: 150 },
      { label: 'Subject', w: 160 },
      { label: 'Status', w: 58 },
      { label: 'Delivered', w: 56 },
      { label: 'Bounced', w: 50 },
      { label: 'Time (IST)', w: 0 },  // fill remainder
    ];
    // Calculate last col width
    const usedW = colDefs.slice(0, -1).reduce((s, c) => s + c.w, 0);
    colDefs[colDefs.length - 1].w = contentWidth - usedW;

    const tableHeaderY = doc.y;
    doc.rect(margin, tableHeaderY, contentWidth, 18).fill(INDIGO);

    let cx = margin;
    colDefs.forEach(col => {
      doc.fillColor(WHITE).font('Helvetica-Bold').fontSize(7.5)
        .text(col.label, cx + 3, tableHeaderY + 5, { width: col.w - 6, align: 'left' });
      cx += col.w;
    });

    doc.y = tableHeaderY + 18;

    const statusColors: Record<string, string> = {
      delivered: GREEN,
      bounced: RED,
      sent: INDIGO,
      failed: ORANGE,
    };

    params.rows.forEach((row, idx) => {
      const rowY = doc.y;

      // Paginate
      if (rowY > 720) {
        addFooter();
        doc.addPage();
        pageNum++;
        addHeader();
        doc.y += 8;
      }

      const currentY = doc.y;
      const bg = idx % 2 === 0 ? WHITE : '#F9FAFB';
      doc.rect(margin, currentY, contentWidth, 16).fill(bg);

      const status = getDisplayStatus(row);
      const time = formatTimeIST(row.sent_at);

      const values = [
        String(idx + 1),
        row.recipient,
        row.subject,
        status,
        row.delivered ? 'Yes' : 'No',
        row.bounced ? 'Yes' : 'No',
        time,
      ];

      let vx = margin;
      values.forEach((val, vi) => {
        const col = colDefs[vi];
        const isStatus = vi === 3;
        doc.fillColor(isStatus ? (statusColors[val] || DARK) : DARK)
          .font(isStatus ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(7)
          .text(val, vx + 3, currentY + 4, { width: col.w - 6, align: 'left', lineBreak: false });
        vx += col.w;
      });

      doc.y = currentY + 16;
    });

    addFooter();
    doc.end();
  });
}

function buildHtmlBody(params: {
  clientName: string;
  period: string;
  total: number;
  delivered: number;
  bounced: number;
  failed: number;
  deliveryRate: string;
  bounceRate: string;
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F3F4F6;padding:24px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
        <!-- Header -->
        <tr>
          <td style="background:#4F46E5;padding:24px 32px;">
            <h1 style="margin:0;color:#ffffff;font-size:22px;font-weight:700;">LumosMails</h1>
            <p style="margin:4px 0 0;color:#C7D2FE;font-size:13px;">Email Performance Report</p>
          </td>
        </tr>
        <!-- Subheader -->
        <tr>
          <td style="padding:20px 32px 8px;border-bottom:1px solid #E5E7EB;">
            <p style="margin:0;font-size:15px;color:#111827;font-weight:600;">${params.clientName}</p>
            <p style="margin:4px 0 0;font-size:13px;color:#6B7280;">Period: ${params.period}</p>
          </td>
        </tr>
        <!-- Stats -->
        <tr>
          <td style="padding:24px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td width="25%" style="text-align:center;padding:12px;background:#EEF2FF;border-radius:6px;margin:0 4px;">
                  <div style="font-size:24px;font-weight:700;color:#4F46E5;">${params.total}</div>
                  <div style="font-size:11px;color:#6B7280;margin-top:4px;">Total Sent</div>
                </td>
                <td width="4%" style="font-size:1px;">&nbsp;</td>
                <td width="25%" style="text-align:center;padding:12px;background:#F0FDF4;border-radius:6px;">
                  <div style="font-size:24px;font-weight:700;color:#16A34A;">${params.delivered}</div>
                  <div style="font-size:11px;color:#6B7280;margin-top:4px;">Delivered (${params.deliveryRate}%)</div>
                </td>
                <td width="4%" style="font-size:1px;">&nbsp;</td>
                <td width="25%" style="text-align:center;padding:12px;background:#FEF2F2;border-radius:6px;">
                  <div style="font-size:24px;font-weight:700;color:#DC2626;">${params.bounced}</div>
                  <div style="font-size:11px;color:#6B7280;margin-top:4px;">Bounced (${params.bounceRate}%)</div>
                </td>
                <td width="4%" style="font-size:1px;">&nbsp;</td>
                <td width="25%" style="text-align:center;padding:12px;background:#FFFBEB;border-radius:6px;">
                  <div style="font-size:24px;font-weight:700;color:#D97706;">${params.failed}</div>
                  <div style="font-size:11px;color:#6B7280;margin-top:4px;">Failed</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>
        <!-- Body text -->
        <tr>
          <td style="padding:0 32px 24px;">
            <p style="margin:0 0 8px;font-size:14px;color:#374151;">
              Your email performance report for <strong>${params.period}</strong> is ready.
            </p>
            <p style="margin:0;font-size:14px;color:#374151;">
              See the attached <strong>CSV</strong> and <strong>PDF</strong> for full details including a complete log of all emails sent during this period.
            </p>
          </td>
        </tr>
        <!-- Footer -->
        <tr>
          <td style="background:#4F46E5;padding:16px 32px;text-align:center;">
            <p style="margin:0;font-size:11px;color:#C7D2FE;">LumosMails by LumosLogic &nbsp;|&nbsp; Confidential</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export async function sendReportEmail(params: {
  clientId: string;
  clientName: string;
  reportEmail: string;
  type: 'daily' | 'monthly';
  fromDate: string;  // YYYY-MM-DD
  toDate: string;    // YYYY-MM-DD
}): Promise<void> {
  const { clientId, clientName, reportEmail, type, fromDate, toDate } = params;

  const { rows } = await pool.query<EmailLogRow>(
    `SELECT recipient, subject, status, delivered, bounced, sent_at
     FROM email_logs
     WHERE client_id = $1
       AND sent_at >= $2::date
       AND sent_at < ($3::date + interval '1 day')
     ORDER BY sent_at ASC`,
    [clientId, fromDate, toDate]
  );

  const total = rows.length;
  const deliveredCount = rows.filter(r => r.delivered).length;
  const bouncedCount = rows.filter(r => r.bounced).length;
  const failedCount = rows.filter(r => !r.delivered && !r.bounced && r.status !== 'sent').length;
  const deliveryRate = total > 0 ? ((deliveredCount / total) * 100).toFixed(1) : '0.0';
  const bounceRate = total > 0 ? ((bouncedCount / total) * 100).toFixed(1) : '0.0';

  const period = fromDate === toDate ? fromDate : `${fromDate} to ${toDate}`;

  const csvBuffer = generateCsvBuffer(rows);
  const pdfBuffer = await generatePdfBuffer({
    rows,
    clientName,
    period,
    total,
    delivered: deliveredCount,
    bounced: bouncedCount,
    failed: failedCount,
    deliveryRate,
    bounceRate,
  });

  const subject = type === 'daily'
    ? `LumosMails Daily Report - ${clientName} - ${fromDate}`
    : `LumosMails Monthly Report - ${clientName} - ${period}`;

  const body = buildHtmlBody({
    clientName,
    period,
    total,
    delivered: deliveredCount,
    bounced: bouncedCount,
    failed: failedCount,
    deliveryRate,
    bounceRate,
  });

  const dateStr = fromDate.replace(/-/g, '');
  const csvFilename = `lumosmails-report-${clientName.replace(/\s+/g, '-').toLowerCase()}-${dateStr}.csv`;
  const pdfFilename = `lumosmails-report-${clientName.replace(/\s+/g, '-').toLowerCase()}-${dateStr}.pdf`;

  await sendEmail({
    from: config.reportSmtp.from ? `LumosMails Reports <${config.reportSmtp.from}>` : config.ses.defaultFrom,
    to: reportEmail,
    subject,
    body,
    isHtml: true,
    attachments: [
      { filename: csvFilename, content: csvBuffer, contentType: 'text/csv' },
      { filename: pdfFilename, content: pdfBuffer, contentType: 'application/pdf' },
    ],
    smtpConfig: config.reportSmtp.user ? {
      host: config.reportSmtp.host,
      port: config.reportSmtp.port,
      user: config.reportSmtp.user,
      pass: config.reportSmtp.pass,
      configSet: '',
    } : undefined,
  });
}
