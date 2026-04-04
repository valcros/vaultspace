/**
 * Intelligent Thumbnail Cropper
 *
 * Analyzes images to find content regions and creates thumbnails
 * that show meaningful content rather than empty/white areas.
 */

import sharp from 'sharp';

/**
 * Result of analyzing an image for content.
 */
interface ContentAnalysis {
  hasContent: boolean;
  contentRatio: number; // Ratio of non-background pixels
  trimBounds?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

/**
 * Options for intelligent thumbnail generation.
 */
export interface SmartThumbnailOptions {
  width: number;
  height: number;
  /** Minimum ratio of content pixels to consider image non-empty (0-1) */
  minContentRatio?: number;
  /** Background color tolerance for trim (0-255) */
  trimThreshold?: number;
  /** Minimum dimension for trimmed content to be valid */
  minTrimSize?: number;
}

const DEFAULT_OPTIONS: Required<Omit<SmartThumbnailOptions, 'width' | 'height'>> = {
  minContentRatio: 0.01, // At least 1% non-background pixels
  trimThreshold: 10, // Color tolerance for detecting background
  minTrimSize: 50, // Minimum 50px in any dimension
};

export class ThumbnailCropper {
  /**
   * Generate a smart thumbnail that finds and focuses on content.
   *
   * Strategy:
   * 1. Try to trim uniform borders (white/light areas)
   * 2. If trimmed content is too small, use center crop
   * 3. Resize to target dimensions
   *
   * @param imageBuffer - Source PNG image
   * @param options - Thumbnail options
   * @returns PNG thumbnail buffer
   */
  async createSmartThumbnail(
    imageBuffer: Buffer,
    options: SmartThumbnailOptions
  ): Promise<Buffer> {
    const { width, height } = options;
    const minContentRatio = options.minContentRatio ?? DEFAULT_OPTIONS.minContentRatio;
    const trimThreshold = options.trimThreshold ?? DEFAULT_OPTIONS.trimThreshold;
    const minTrimSize = options.minTrimSize ?? DEFAULT_OPTIONS.minTrimSize;

    try {
      // Get original image metadata
      const metadata = await sharp(imageBuffer).metadata();
      const origWidth = metadata.width || 0;
      const origHeight = metadata.height || 0;

      if (origWidth === 0 || origHeight === 0) {
        // Invalid image, return as-is resized
        return this.simpleResize(imageBuffer, width, height);
      }

      // Try to trim the image to content
      const trimResult = await this.tryTrim(imageBuffer, trimThreshold);

      if (trimResult && trimResult.width >= minTrimSize && trimResult.height >= minTrimSize) {
        // Check if trimmed area is significantly different from original
        const trimRatio =
          (trimResult.width * trimResult.height) / (origWidth * origHeight);

        if (trimRatio < 0.9) {
          // Trimming found content - use the trimmed region
          return await this.cropAndResize(
            imageBuffer,
            trimResult.left,
            trimResult.top,
            trimResult.width,
            trimResult.height,
            width,
            height
          );
        }
      }

      // Analyze for content density to determine best crop strategy
      const analysis = await this.analyzeContent(imageBuffer, origWidth, origHeight);

      if (analysis.hasContent && analysis.contentRatio >= minContentRatio) {
        // Has meaningful content - use fit: contain to show everything
        return await sharp(imageBuffer)
          .resize(width, height, {
            fit: 'contain',
            background: { r: 255, g: 255, b: 255, alpha: 1 },
          })
          .png()
          .toBuffer();
      }

      // Low content image - use center crop as fallback
      return await sharp(imageBuffer)
        .resize(width, height, {
          fit: 'cover',
          position: 'centre',
        })
        .png()
        .toBuffer();
    } catch (error) {
      console.error('[ThumbnailCropper] Smart thumbnail failed:', error);
      // Fallback to simple resize
      return this.simpleResize(imageBuffer, width, height);
    }
  }

  /**
   * Try to trim uniform borders from the image.
   * Returns the bounds of the content area.
   */
  private async tryTrim(
    imageBuffer: Buffer,
    threshold: number
  ): Promise<{ left: number; top: number; width: number; height: number } | null> {
    try {
      // Sharp's trim() removes uniform borders
      const trimmed = sharp(imageBuffer).trim({ threshold });
      const info = await trimmed.toBuffer({ resolveWithObject: true });

      if (info.info.trimOffsetLeft !== undefined && info.info.trimOffsetTop !== undefined) {
        return {
          left: Math.abs(info.info.trimOffsetLeft),
          top: Math.abs(info.info.trimOffsetTop),
          width: info.info.width,
          height: info.info.height,
        };
      }
      return null;
    } catch {
      // Trim failed (e.g., all same color)
      return null;
    }
  }

  /**
   * Analyze image to determine content density.
   * Samples pixels to determine what ratio is non-background.
   */
  private async analyzeContent(
    imageBuffer: Buffer,
    _width: number,
    _height: number
  ): Promise<ContentAnalysis> {
    try {
      // Downsample to small size for fast analysis
      const sampleSize = 100;
      const { data, info } = await sharp(imageBuffer)
        .resize(sampleSize, sampleSize, { fit: 'fill' })
        .raw()
        .toBuffer({ resolveWithObject: true });

      const channels = info.channels;
      const totalPixels = info.width * info.height;
      let nonBackgroundPixels = 0;

      // Count pixels that aren't near-white (background)
      for (let i = 0; i < data.length; i += channels) {
        const r = data[i] || 0;
        const g = data[i + 1] || 0;
        const b = data[i + 2] || 0;

        // Check if pixel is significantly different from white
        // Using a generous threshold to catch light gray content too
        const isBackground = r > 240 && g > 240 && b > 240;

        if (!isBackground) {
          nonBackgroundPixels++;
        }
      }

      const contentRatio = nonBackgroundPixels / totalPixels;

      return {
        hasContent: contentRatio > 0.001, // At least 0.1% non-white
        contentRatio,
      };
    } catch {
      return { hasContent: true, contentRatio: 0.5 }; // Assume content on error
    }
  }

  /**
   * Crop to a specific region and resize.
   */
  private async cropAndResize(
    imageBuffer: Buffer,
    left: number,
    top: number,
    cropWidth: number,
    cropHeight: number,
    targetWidth: number,
    targetHeight: number
  ): Promise<Buffer> {
    // Add small padding around the crop
    const padding = Math.min(cropWidth, cropHeight) * 0.05;
    const paddedLeft = Math.max(0, left - padding);
    const paddedTop = Math.max(0, top - padding);
    const paddedWidth = cropWidth + padding * 2;
    const paddedHeight = cropHeight + padding * 2;

    return await sharp(imageBuffer)
      .extract({
        left: Math.round(paddedLeft),
        top: Math.round(paddedTop),
        width: Math.round(paddedWidth),
        height: Math.round(paddedHeight),
      })
      .resize(targetWidth, targetHeight, {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer();
  }

  /**
   * Simple resize fallback.
   */
  private async simpleResize(
    imageBuffer: Buffer,
    width: number,
    height: number
  ): Promise<Buffer> {
    return sharp(imageBuffer)
      .resize(width, height, { fit: 'cover', position: 'centre' })
      .png()
      .toBuffer();
  }
}
