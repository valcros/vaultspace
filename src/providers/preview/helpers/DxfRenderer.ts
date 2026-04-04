/**
 * DXF Renderer Helper
 *
 * Parses DXF (Drawing Exchange Format) files and renders them to PNG
 * via an SVG intermediate format using the dxf-parser library.
 *
 * DXF is a CAD file format originally developed by Autodesk for AutoCAD.
 * This renderer handles basic 2D entities (lines, circles, arcs, polylines).
 */

import sharp from 'sharp';
import DxfParser from 'dxf-parser';

/**
 * MIME types supported by DXF renderer.
 * Includes all common DXF MIME type variants.
 */
export const DXF_SUPPORTED_TYPES = new Set([
  'application/dxf',
  'image/vnd.dxf',
  'application/x-dxf',
  'image/x-dxf',
]);

// Default canvas dimensions for rendering
const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 600;
const PADDING = 20;

interface DxfEntity {
  type: string;
  vertices?: Array<{ x: number; y: number }>;
  center?: { x: number; y: number };
  radius?: number;
  startAngle?: number;
  endAngle?: number;
  x?: number;
  y?: number;
  x2?: number;
  y2?: number;
  layer?: string;
}

interface DxfFile {
  entities?: DxfEntity[];
}

export class DxfRenderer {
  /**
   * Static accessor for supported MIME types.
   */
  static readonly SUPPORTED_TYPES = DXF_SUPPORTED_TYPES;

  /**
   * Check if a MIME type is supported by this renderer.
   */
  static isSupported(mimeType: string): boolean {
    return DXF_SUPPORTED_TYPES.has(mimeType);
  }

  /**
   * Render a DXF file to PNG.
   *
   * @param data - The DXF file content as a Buffer
   * @param width - Target width in pixels (default: 800)
   * @param height - Target height in pixels (default: 600)
   * @returns PNG buffer
   */
  async render(data: Buffer, width: number = DEFAULT_WIDTH, height: number = DEFAULT_HEIGHT): Promise<Buffer> {
    try {
      // Parse DXF content
      const parser = new DxfParser();
      const dxfContent = data.toString('utf-8');
      const dxf = parser.parseSync(dxfContent) as DxfFile | null;

      if (!dxf || !dxf.entities || dxf.entities.length === 0) {
        return this.generateEmptyPlaceholder(width, height);
      }

      // Calculate bounding box of all entities
      const bounds = this.calculateBounds(dxf.entities);

      // Generate SVG from DXF entities
      const svg = this.generateSvg(dxf.entities, bounds, width, height);

      // Convert SVG to PNG using Sharp
      const pngBuffer = await sharp(Buffer.from(svg))
        .resize(width, height, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
        .png()
        .toBuffer();

      return pngBuffer;
    } catch (error) {
      console.error('[DxfRenderer] Failed to render DXF:', error);
      return this.generateEmptyPlaceholder(width, height);
    }
  }

  /**
   * Calculate the bounding box of all entities.
   */
  private calculateBounds(entities: DxfEntity[]): { minX: number; minY: number; maxX: number; maxY: number } {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    const updateBounds = (x: number, y: number) => {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    };

    for (const entity of entities) {
      switch (entity.type) {
        case 'LINE':
          if (entity.x !== undefined && entity.y !== undefined) {
            updateBounds(entity.x, entity.y);
          }
          if (entity.x2 !== undefined && entity.y2 !== undefined) {
            updateBounds(entity.x2, entity.y2);
          }
          break;

        case 'CIRCLE':
          if (entity.center && entity.radius !== undefined) {
            updateBounds(entity.center.x - entity.radius, entity.center.y - entity.radius);
            updateBounds(entity.center.x + entity.radius, entity.center.y + entity.radius);
          }
          break;

        case 'ARC':
          if (entity.center && entity.radius !== undefined) {
            updateBounds(entity.center.x - entity.radius, entity.center.y - entity.radius);
            updateBounds(entity.center.x + entity.radius, entity.center.y + entity.radius);
          }
          break;

        case 'LWPOLYLINE':
        case 'POLYLINE':
          if (entity.vertices) {
            for (const vertex of entity.vertices) {
              updateBounds(vertex.x, vertex.y);
            }
          }
          break;

        case 'POINT':
          if (entity.x !== undefined && entity.y !== undefined) {
            updateBounds(entity.x, entity.y);
          }
          break;
      }
    }

    // Handle case where no valid bounds were found
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
      return { minX: 0, minY: 0, maxX: 100, maxY: 100 };
    }

    return { minX, minY, maxX, maxY };
  }

  /**
   * Generate SVG from DXF entities.
   */
  private generateSvg(
    entities: DxfEntity[],
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
    width: number,
    height: number
  ): string {
    const boundsWidth = bounds.maxX - bounds.minX || 1;
    const boundsHeight = bounds.maxY - bounds.minY || 1;

    // Calculate scale to fit within canvas with padding
    const availableWidth = width - 2 * PADDING;
    const availableHeight = height - 2 * PADDING;
    const scale = Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight);

    // Calculate offset to center the drawing
    const offsetX = PADDING + (availableWidth - boundsWidth * scale) / 2;
    const offsetY = PADDING + (availableHeight - boundsHeight * scale) / 2;

    // Transform function: DXF uses bottom-left origin, SVG uses top-left
    const transformX = (x: number) => offsetX + (x - bounds.minX) * scale;
    const transformY = (y: number) => height - (offsetY + (y - bounds.minY) * scale);

    const svgElements: string[] = [];

    for (const entity of entities) {
      const strokeColor = '#333333';
      const strokeWidth = Math.max(1, scale * 0.5);

      switch (entity.type) {
        case 'LINE':
          if (entity.x !== undefined && entity.y !== undefined && entity.x2 !== undefined && entity.y2 !== undefined) {
            svgElements.push(
              `<line x1="${transformX(entity.x)}" y1="${transformY(entity.y)}" ` +
              `x2="${transformX(entity.x2)}" y2="${transformY(entity.y2)}" ` +
              `stroke="${strokeColor}" stroke-width="${strokeWidth}" />`
            );
          }
          break;

        case 'CIRCLE':
          if (entity.center && entity.radius !== undefined) {
            svgElements.push(
              `<circle cx="${transformX(entity.center.x)}" cy="${transformY(entity.center.y)}" ` +
              `r="${entity.radius * scale}" stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="none" />`
            );
          }
          break;

        case 'ARC':
          if (entity.center && entity.radius !== undefined) {
            const startAngle = ((entity.startAngle ?? 0) * Math.PI) / 180;
            const endAngle = ((entity.endAngle ?? 360) * Math.PI) / 180;
            const r = entity.radius * scale;
            const cx = transformX(entity.center.x);
            const cy = transformY(entity.center.y);

            // Note: Y is flipped, so we also need to flip the arc direction
            const startX = cx + r * Math.cos(startAngle);
            const startY = cy - r * Math.sin(startAngle);
            const endX = cx + r * Math.cos(endAngle);
            const endY = cy - r * Math.sin(endAngle);

            const largeArc = Math.abs(endAngle - startAngle) > Math.PI ? 1 : 0;
            const sweep = 0; // Counter-clockwise due to Y flip

            svgElements.push(
              `<path d="M ${startX} ${startY} A ${r} ${r} 0 ${largeArc} ${sweep} ${endX} ${endY}" ` +
              `stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="none" />`
            );
          }
          break;

        case 'LWPOLYLINE':
        case 'POLYLINE':
          if (entity.vertices && entity.vertices.length > 1) {
            const points = entity.vertices
              .map((v) => `${transformX(v.x)},${transformY(v.y)}`)
              .join(' ');
            svgElements.push(
              `<polyline points="${points}" stroke="${strokeColor}" stroke-width="${strokeWidth}" fill="none" />`
            );
          }
          break;

        case 'POINT':
          if (entity.x !== undefined && entity.y !== undefined) {
            const pointSize = Math.max(2, scale);
            svgElements.push(
              `<circle cx="${transformX(entity.x)}" cy="${transformY(entity.y)}" ` +
              `r="${pointSize}" fill="${strokeColor}" />`
            );
          }
          break;
      }
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="white"/>
  ${svgElements.join('\n  ')}
</svg>`;
  }

  /**
   * Generate an empty placeholder when DXF parsing fails or file is empty.
   */
  private async generateEmptyPlaceholder(width: number, height: number): Promise<Buffer> {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
  <rect width="100%" height="100%" fill="#f9fafb"/>
  <text x="50%" y="45%" text-anchor="middle" font-family="system-ui, sans-serif" font-size="16" fill="#9ca3af">DXF</text>
  <text x="50%" y="55%" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" fill="#9ca3af">No preview available</text>
</svg>`;

    return sharp(Buffer.from(svg)).png().toBuffer();
  }
}
