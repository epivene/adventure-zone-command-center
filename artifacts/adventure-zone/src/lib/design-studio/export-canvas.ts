import {
  resolveImageSrc,
  type DesignAsset,
} from "@/lib/design-studio-api";
import {
  getActivePage,
  type CanvasDocument,
  type CanvasNode,
  type ImageNode,
  type ShapeNode,
  type TextNode,
} from "@/lib/design-studio/model";

const encoder = new TextEncoder();

function hexToRgb(value: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) return [0, 0, 0];
  const hex = match[1]!;
  return [
    parseInt(hex.slice(0, 2), 16) / 255,
    parseInt(hex.slice(2, 4), 16) / 255,
    parseInt(hex.slice(4, 6), 16) / 255,
  ];
}

function safePdfText(value: string) {
  return value
    .replaceAll("★", "*")
    .replaceAll("✓", "v")
    .replaceAll("•", "-")
    .replaceAll("→", ">")
    .replace(/[—–]/g, "-")
    .normalize("NFKD")
    .replace(/[^\x20-\x7e\n]/g, "")
    .replace(/([\\()])/g, "\\$1");
}

function fontCss(node: TextNode) {
  const family = node.fontFamily.includes(" ") ? `"${node.fontFamily}"` : node.fontFamily;
  return `${node.italic ? "italic " : ""}${node.fontWeight} ${node.fontSize}px ${family}`;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Could not load design image (${response.status}).`);
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = new Image();
    image.decoding = "async";
    image.src = objectUrl;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Could not decode a design image."));
    });
    return image;
  } finally {
    // Safari may still be decoding when onload fires, so release on next tick.
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(Math.max(0, radius), width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function starPoints(width: number, height: number) {
  const points: Array<[number, number]> = [];
  const outer = Math.min(width, height) / 2;
  const inner = outer * 0.45;
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return points;
}

function drawShape(ctx: CanvasRenderingContext2D, node: ShapeNode) {
  const x = -node.width / 2;
  const y = -node.height / 2;
  ctx.fillStyle = node.fill;
  ctx.strokeStyle = node.stroke;
  ctx.lineWidth = node.strokeWidth;

  if (node.variant === "circle") {
    ctx.beginPath();
    ctx.ellipse(0, 0, node.width / 2, node.height / 2, 0, 0, Math.PI * 2);
  } else if (node.variant === "triangle") {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(node.width / 2, node.height / 2);
    ctx.lineTo(-node.width / 2, node.height / 2);
    ctx.closePath();
  } else if (node.variant === "star") {
    const points = starPoints(node.width, node.height);
    ctx.beginPath();
    points.forEach(([px, py], index) => index === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py));
    ctx.closePath();
  } else if (node.variant === "line" || node.variant === "arrow") {
    ctx.beginPath();
    ctx.moveTo(-node.width / 2, 0);
    ctx.lineTo(node.width / 2, 0);
    ctx.stroke();
    if (node.variant === "arrow") {
      const head = Math.max(14, node.strokeWidth * 2.5);
      ctx.beginPath();
      ctx.moveTo(node.width / 2, 0);
      ctx.lineTo(node.width / 2 - head, -head * 0.55);
      ctx.lineTo(node.width / 2 - head, head * 0.55);
      ctx.closePath();
      ctx.fill();
    }
    return;
  } else {
    roundedRectPath(ctx, x, y, node.width, node.height, node.cornerRadius);
  }

  if (node.fill !== "transparent") ctx.fill();
  if (node.strokeWidth > 0) ctx.stroke();
}

function drawText(ctx: CanvasRenderingContext2D, node: TextNode) {
  ctx.fillStyle = node.color;
  ctx.font = fontCss(node);
  ctx.textBaseline = "top";
  ctx.textAlign = node.align === "center" ? "center" : node.align === "right" ? "right" : "left";
  const anchorX = node.align === "center" ? 0 : node.align === "right" ? node.width / 2 : -node.width / 2;
  const startY = -node.height / 2;
  const lineStep = node.fontSize * node.lineHeight;
  node.text.split("\n").forEach((line, index) => {
    ctx.fillText(line, anchorX, startY + index * lineStep, node.width);
  });
}

function imagePlacement(node: ImageNode, imageWidth: number, imageHeight: number) {
  const cover = node.fit === "cover";
  const scale = cover
    ? Math.max(node.width / imageWidth, node.height / imageHeight)
    : Math.min(node.width / imageWidth, node.height / imageHeight);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  const extraX = drawWidth - node.width;
  const extraY = drawHeight - node.height;

  if (cover) {
    return {
      x: -node.width / 2 - extraX * (node.objectPositionX / 100),
      y: -node.height / 2 - extraY * (node.objectPositionY / 100),
      width: drawWidth,
      height: drawHeight,
    };
  }

  return {
    x: -node.width / 2 + (node.width - drawWidth) * (node.objectPositionX / 100),
    y: -node.height / 2 + (node.height - drawHeight) * (node.objectPositionY / 100),
    width: drawWidth,
    height: drawHeight,
  };
}

async function drawImage(ctx: CanvasRenderingContext2D, node: ImageNode, assets: DesignAsset[]) {
  const src = resolveImageSrc(node, assets);
  if (!src) return;
  const image = await loadImage(src);
  const placement = imagePlacement(node, image.naturalWidth, image.naturalHeight);
  ctx.save();
  ctx.beginPath();
  ctx.rect(-node.width / 2, -node.height / 2, node.width, node.height);
  ctx.clip();
  ctx.drawImage(image, placement.x, placement.y, placement.width, placement.height);
  ctx.restore();
}

async function renderNode(ctx: CanvasRenderingContext2D, node: CanvasNode, assets: DesignAsset[]) {
  if (node.hidden) return;
  ctx.save();
  ctx.globalAlpha = node.opacity;
  ctx.translate(node.x + node.width / 2, node.y + node.height / 2);
  ctx.rotate((node.rotation * Math.PI) / 180);
  if (node.kind === "text") drawText(ctx, node);
  else if (node.kind === "shape") drawShape(ctx, node);
  else await drawImage(ctx, node, assets);
  ctx.restore();
}

export async function renderCanvasBitmap(doc: CanvasDocument, assets: DesignAsset[], scale = 1) {
  const page = getActivePage(doc);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(doc.width * scale));
  canvas.height = Math.max(1, Math.round(doc.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot render the design for export.");
  ctx.scale(scale, scale);
  ctx.fillStyle = page.background;
  ctx.fillRect(0, 0, doc.width, doc.height);
  for (const node of page.nodes) await renderNode(ctx, node, assets);
  return canvas;
}

export async function exportCanvasPng(doc: CanvasDocument, assets: DesignAsset[]) {
  const canvas = await renderCanvasBitmap(doc, assets, 2);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not create a PNG from this design.");
  return blob;
}

async function imageNodeToJpeg(node: ImageNode, assets: DesignAsset[]) {
  const src = resolveImageSrc(node, assets);
  if (!src) return null;
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, image.naturalWidth);
  canvas.height = Math.max(1, image.naturalHeight);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot prepare a design image for PDF export.");
  ctx.drawImage(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
  if (!blob) throw new Error("Could not prepare a design image for PDF export.");
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    width: canvas.width,
    height: canvas.height,
  };
}

type PreparedPdfImage = {
  nodeId: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  objectId: number;
  resourceName: string;
};

function pdfColor(value: string, stroke = false) {
  const [r, g, b] = hexToRgb(value);
  return `${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} ${stroke ? "RG" : "rg"}`;
}

function transformCommand(node: CanvasNode, pageHeight: number) {
  const cx = node.x + node.width / 2;
  const cy = pageHeight - (node.y + node.height / 2);
  const radians = (-node.rotation * Math.PI) / 180;
  const cos = Math.cos(radians).toFixed(6);
  const sin = Math.sin(radians).toFixed(6);
  return `${cos} ${sin} ${(-Math.sin(radians)).toFixed(6)} ${Math.cos(radians).toFixed(6)} ${cx.toFixed(3)} ${cy.toFixed(3)} cm`;
}

function pdfStarPath(width: number, height: number) {
  return starPoints(width, height)
    .map(([x, y], index) => `${x.toFixed(2)} ${(-y).toFixed(2)} ${index === 0 ? "m" : "l"}`)
    .join("\n") + "\nh";
}

function pdfShape(node: ShapeNode) {
  const x = -node.width / 2;
  const y = -node.height / 2;
  const commands = [pdfColor(node.fill), pdfColor(node.stroke, true), `${node.strokeWidth.toFixed(2)} w`];

  if (node.variant === "circle") {
    const rx = node.width / 2;
    const ry = node.height / 2;
    const k = 0.5522847498;
    commands.push(
      `${rx.toFixed(2)} 0 m`,
      `${rx.toFixed(2)} ${(ry * k).toFixed(2)} ${(rx * k).toFixed(2)} ${ry.toFixed(2)} 0 ${ry.toFixed(2)} c`,
      `${(-rx * k).toFixed(2)} ${ry.toFixed(2)} ${(-rx).toFixed(2)} ${(ry * k).toFixed(2)} ${(-rx).toFixed(2)} 0 c`,
      `${(-rx).toFixed(2)} ${(-ry * k).toFixed(2)} ${(-rx * k).toFixed(2)} ${(-ry).toFixed(2)} 0 ${(-ry).toFixed(2)} c`,
      `${(rx * k).toFixed(2)} ${(-ry).toFixed(2)} ${rx.toFixed(2)} ${(-ry * k).toFixed(2)} ${rx.toFixed(2)} 0 c`,
      "h",
    );
  } else if (node.variant === "triangle") {
    commands.push(`0 ${(node.height / 2).toFixed(2)} m`, `${(node.width / 2).toFixed(2)} ${(-node.height / 2).toFixed(2)} l`, `${(-node.width / 2).toFixed(2)} ${(-node.height / 2).toFixed(2)} l`, "h");
  } else if (node.variant === "star") {
    commands.push(pdfStarPath(node.width, node.height));
  } else if (node.variant === "line" || node.variant === "arrow") {
    commands.push(`${(-node.width / 2).toFixed(2)} 0 m`, `${(node.width / 2).toFixed(2)} 0 l`, "S");
    if (node.variant === "arrow") {
      const head = Math.max(14, node.strokeWidth * 2.5);
      commands.push(`${(node.width / 2).toFixed(2)} 0 m`, `${(node.width / 2 - head).toFixed(2)} ${(head * 0.55).toFixed(2)} l`, `${(node.width / 2 - head).toFixed(2)} ${(-head * 0.55).toFixed(2)} l`, "h", "f");
    }
    return commands.join("\n");
  } else {
    commands.push(`${x.toFixed(2)} ${y.toFixed(2)} ${node.width.toFixed(2)} ${node.height.toFixed(2)} re`);
  }

  if (node.fill === "transparent") commands.push(node.strokeWidth > 0 ? "S" : "n");
  else if (node.strokeWidth > 0) commands.push("B");
  else commands.push("f");
  return commands.join("\n");
}

function fontResource(node: TextNode) {
  const bold = node.fontWeight >= 600;
  if (bold && node.italic) return "F4";
  if (bold) return "F2";
  if (node.italic) return "F3";
  return "F1";
}

function estimatedTextWidth(text: string, fontSize: number) {
  return text.length * fontSize * 0.52;
}

function pdfText(node: TextNode) {
  const commands = [pdfColor(node.color), "BT", `/${fontResource(node)} ${node.fontSize.toFixed(2)} Tf`];
  const lineStep = node.fontSize * node.lineHeight;
  const top = node.height / 2 - node.fontSize;
  node.text.split("\n").forEach((raw, index) => {
    const line = safePdfText(raw);
    const width = estimatedTextWidth(line, node.fontSize);
    const x = node.align === "center" ? -width / 2 : node.align === "right" ? node.width / 2 - width : -node.width / 2;
    const y = top - index * lineStep;
    commands.push(`1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${line}) Tj`);
  });
  commands.push("ET");
  return commands.join("\n");
}

function pdfImage(node: ImageNode, prepared: PreparedPdfImage) {
  const placement = imagePlacement(node, prepared.width, prepared.height);
  const x = placement.x;
  const y = node.fit === "cover"
    ? node.height / 2 - placement.height + (placement.height - node.height) * (node.objectPositionY / 100)
    : -node.height / 2 + (node.height - placement.height) * (1 - node.objectPositionY / 100);
  return [
    `${(-node.width / 2).toFixed(2)} ${(-node.height / 2).toFixed(2)} ${node.width.toFixed(2)} ${node.height.toFixed(2)} re W n`,
    `${placement.width.toFixed(2)} 0 0 ${placement.height.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm`,
    `/${prepared.resourceName} Do`,
  ].join("\n");
}

function bytes(value: string) {
  return encoder.encode(value);
}

function concatBytes(parts: Uint8Array[]) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    result.set(part, offset);
    offset += part.length;
  });
  return result;
}

function streamObject(objectId: number, dictionary: string, data: Uint8Array) {
  return concatBytes([
    bytes(`${objectId} 0 obj\n<< ${dictionary} /Length ${data.length} >>\nstream\n`),
    data,
    bytes("\nendstream\nendobj\n"),
  ]);
}

function plainObject(objectId: number, body: string) {
  return bytes(`${objectId} 0 obj\n${body}\nendobj\n`);
}

export async function exportCanvasPdf(doc: CanvasDocument, assets: DesignAsset[]) {
  const page = getActivePage(doc);
  const visibleImages = page.nodes.filter((node): node is ImageNode => node.kind === "image" && !node.hidden);
  const imageResults = await Promise.all(visibleImages.map(async (node) => ({ node, data: await imageNodeToJpeg(node, assets) })));
  const preparedRaw = imageResults.filter((item): item is { node: ImageNode; data: NonNullable<Awaited<ReturnType<typeof imageNodeToJpeg>>> } => Boolean(item.data));
  const opacities = Array.from(new Set(page.nodes.filter((node) => !node.hidden && node.opacity < 0.999).map((node) => Math.max(0, Math.min(1, node.opacity)))));

  const imageStart = 8;
  const gsStart = imageStart + preparedRaw.length;
  const contentId = gsStart + opacities.length;
  const totalObjects = contentId;

  const preparedImages: PreparedPdfImage[] = preparedRaw.map((item, index) => ({
    nodeId: item.node.id,
    bytes: item.data.bytes,
    width: item.data.width,
    height: item.data.height,
    objectId: imageStart + index,
    resourceName: `Im${index + 1}`,
  }));
  const imageByNode = new Map(preparedImages.map((image) => [image.nodeId, image]));
  const gsByOpacity = new Map(opacities.map((opacity, index) => [opacity, { objectId: gsStart + index, name: `GS${index + 1}` }]));

  const content: string[] = [];
  content.push("q", pdfColor(page.background), `0 0 ${doc.width.toFixed(2)} ${doc.height.toFixed(2)} re f`, "Q");
  for (const node of page.nodes) {
    if (node.hidden) continue;
    content.push("q");
    const gs = gsByOpacity.get(Math.max(0, Math.min(1, node.opacity)));
    if (gs) content.push(`/${gs.name} gs`);
    content.push(transformCommand(node, doc.height));
    if (node.kind === "text") content.push(pdfText(node));
    else if (node.kind === "shape") content.push(pdfShape(node));
    else {
      const prepared = imageByNode.get(node.id);
      if (prepared) content.push(pdfImage(node, prepared));
    }
    content.push("Q");
  }
  const contentBytes = bytes(content.join("\n"));

  const fontResources = "/Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R /F4 7 0 R >>";
  const imageResources = preparedImages.length
    ? `/XObject << ${preparedImages.map((image) => `/${image.resourceName} ${image.objectId} 0 R`).join(" ")} >>`
    : "";
  const gsResources = opacities.length
    ? `/ExtGState << ${opacities.map((opacity) => { const gs = gsByOpacity.get(opacity)!; return `/${gs.name} ${gs.objectId} 0 R`; }).join(" ")} >>`
    : "";

  const objects = new Map<number, Uint8Array>();
  objects.set(1, plainObject(1, "<< /Type /Catalog /Pages 2 0 R >>"));
  objects.set(2, plainObject(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>"));
  objects.set(3, plainObject(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${doc.width.toFixed(2)} ${doc.height.toFixed(2)}] /Resources << ${fontResources} ${imageResources} ${gsResources} >> /Contents ${contentId} 0 R >>`));
  objects.set(4, plainObject(4, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"));
  objects.set(5, plainObject(5, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"));
  objects.set(6, plainObject(6, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>"));
  objects.set(7, plainObject(7, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique >>"));
  preparedImages.forEach((image) => {
    objects.set(image.objectId, streamObject(
      image.objectId,
      `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,
      image.bytes,
    ));
  });
  opacities.forEach((opacity) => {
    const gs = gsByOpacity.get(opacity)!;
    objects.set(gs.objectId, plainObject(gs.objectId, `<< /Type /ExtGState /ca ${opacity.toFixed(3)} /CA ${opacity.toFixed(3)} >>`));
  });
  objects.set(contentId, streamObject(contentId, "", contentBytes));

  const header = bytes("%PDF-1.4\n%AVZ\n");
  const ordered: Uint8Array[] = [header];
  const offsets = new Array(totalObjects + 1).fill(0);
  let cursor = header.length;
  for (let objectId = 1; objectId <= totalObjects; objectId += 1) {
    const object = objects.get(objectId);
    if (!object) throw new Error(`PDF export is missing object ${objectId}.`);
    offsets[objectId] = cursor;
    ordered.push(object);
    cursor += object.length;
  }

  const xrefOffset = cursor;
  const xrefRows = ["0000000000 65535 f "];
  for (let objectId = 1; objectId <= totalObjects; objectId += 1) {
    xrefRows.push(`${String(offsets[objectId]).padStart(10, "0")} 00000 n `);
  }
  ordered.push(bytes(`xref\n0 ${totalObjects + 1}\n${xrefRows.join("\n")}\ntrailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));

  return new Blob([concatBytes(ordered)], { type: "application/pdf" });
}

export function downloadDesignBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
