function pdfEscape(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function renderContractPdf(input: {
  title: string;
  organizationName: string;
  customerName: string;
  customerEmail: string;
  bookingName?: string | null;
  content: string;
}) {
  const plain = input.content.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const lines = [
    input.title,
    "",
    `Customer: ${input.customerName} <${input.customerEmail}>`,
    `Profile: ${input.organizationName}`,
    input.bookingName ? `Booking: ${input.bookingName}` : "",
    "",
    plain,
  ].filter(Boolean).flatMap((line) => line.match(/.{1,92}/g) ?? [""]);
  const stream = [
    "BT",
    "/F1 11 Tf",
    "54 742 Td",
    ...lines.flatMap((line, index) => [`(${pdfEscape(line)}) Tj`, index === lines.length - 1 ? "" : "0 -15 Td"]).filter(Boolean),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i += 1) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}