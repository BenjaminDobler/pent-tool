import { VectorPath, AnchorPoint, Point } from '../core/types';
import { PathManager } from '../core/path';
import { HandleManager } from '../core/handles';
import { IPathRenderer, RenderOptions } from './IPathRenderer';

export type { RenderOptions } from './IPathRenderer';

/**
 * Canvas 2D renderer for paths, anchor points, handles, and UI feedback
 */
export class CanvasPathRenderer implements IPathRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private options: Required<RenderOptions>;
  private pathManager: PathManager | null = null;
  private previewElements: {
    line?: { from: Point; to: Point };
    curve?: { start: Point; control1: Point; control2: Point; end: Point };
    closeIndicator?: { point: Point; show: boolean };
    hoverPoint?: Point | null;
  } = {};

  constructor(canvas: HTMLCanvasElement, pathManager?: PathManager, options: RenderOptions = {}) {
    this.canvas = canvas;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to get 2D context from canvas');
    }
    this.ctx = context;

    this.options = {
      strokeColor: options.strokeColor ?? '#000000',
      strokeWidth: options.strokeWidth ?? 2,
      fillColor: options.fillColor ?? 'none',
      selectionColor: options.selectionColor ?? '#0066FF',
      anchorPointColor: options.anchorPointColor ?? '#FFFFFF',
      anchorPointSize: options.anchorPointSize ?? 6,
      handleColor: options.handleColor ?? '#0066FF',
      previewColor: options.previewColor ?? '#999999',
      showAllHandles: options.showAllHandles ?? false,
      autoImport: options.autoImport ?? true
    };

    // Enable high DPI rendering
    this.setupHighDPI();

    // Auto-import existing paths if enabled and SVG data is available
    if (pathManager && this.options.autoImport) {
      this.pathManager = pathManager;
      this.autoImportFromDataAttribute();
    }
  }

  /**
   * Import paths from data-svg-paths attribute if present
   */
  private autoImportFromDataAttribute(): void {
    if (!this.pathManager) return;

    const svgData = this.canvas.getAttribute('data-svg-paths');
    if (svgData) {
      try {
        const pathsData = JSON.parse(svgData) as Array<{ d: string; stroke?: string; strokeWidth?: number; fill?: string }>;
        pathsData.forEach(pathData => {
          this.pathManager!.importFromSVG(pathData.d, {
            stroke: pathData.stroke,
            strokeWidth: pathData.strokeWidth,
            fill: pathData.fill
          });
        });
        // Render the imported paths
        this.renderPaths(this.pathManager);
      } catch (error) {
        console.error('Failed to parse data-svg-paths attribute:', error);
      }
    }
  }

  /**
   * Setup high DPI rendering for retina displays
   */
  private setupHighDPI(): void {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    
    this.ctx.scale(dpr, dpr);
    
    this.canvas.style.width = rect.width + 'px';
    this.canvas.style.height = rect.height + 'px';
  }

  /**
   * Render all paths
   */
  renderPaths(pathManager: PathManager): void {
    const paths = pathManager.getAllPaths();
    for (const path of paths) {
      this.renderPath(path, pathManager);
    }
  }

  /**
   * Render a single path
   */
  private renderPath(path: VectorPath, pathManager: PathManager): void {
    if (path.anchorPoints.length === 0) return;

    const segments = pathManager.getSegments(path);
    if (segments.length === 0) return;

    this.ctx.beginPath();

    // Move to first point
    const firstPoint = path.anchorPoints[0];
    this.ctx.moveTo(firstPoint.position.x, firstPoint.position.y);

    // Draw segments
    for (const segment of segments) {
      if (segment.type === 'line') {
        this.ctx.lineTo(segment.endPoint.position.x, segment.endPoint.position.y);
      } else if (segment.controlPoint1 && segment.controlPoint2) {
        // Cubic Bezier curve
        this.ctx.bezierCurveTo(
          segment.controlPoint1.x,
          segment.controlPoint1.y,
          segment.controlPoint2.x,
          segment.controlPoint2.y,
          segment.endPoint.position.x,
          segment.endPoint.position.y
        );
      }
    }

    // Apply stroke
    this.ctx.strokeStyle = path.selected ? this.options.selectionColor : (path.stroke || this.options.strokeColor);
    this.ctx.lineWidth = path.strokeWidth || this.options.strokeWidth;
    this.ctx.stroke();

    // Apply fill if path is closed
    if (path.closed && this.options.fillColor !== 'none') {
      this.ctx.fillStyle = path.fill || this.options.fillColor;
      this.ctx.fill();
    }
  }

  /**
   * Render all anchor points
   */
  renderAnchorPoints(pathManager: PathManager): void {
    const paths = pathManager.getAllPaths();
    for (const path of paths) {
      for (const point of path.anchorPoints) {
        this.renderAnchorPoint(point);
      }
    }
  }

  /**
   * Render a single anchor point
   */
  private renderAnchorPoint(point: AnchorPoint): void {
    this.ctx.beginPath();
    this.ctx.arc(
      point.position.x,
      point.position.y,
      this.options.anchorPointSize,
      0,
      Math.PI * 2
    );

    this.ctx.fillStyle = this.options.anchorPointColor;
    this.ctx.fill();

    this.ctx.strokeStyle = point.selected ? this.options.selectionColor : '#000000';
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();
  }

  /**
   * Render all handles
   */
  renderHandles(pathManager: PathManager, currentDrawingPath?: VectorPath | null): void {
    const paths = pathManager.getAllPaths();
    for (const path of paths) {
      for (let i = 0; i < path.anchorPoints.length; i++) {
        const point = path.anchorPoints[i];
        let showHandles = this.options.showAllHandles || point.selected;
        
        // If this is the current drawing path, only show handles for the last point (and current if being dragged)
        if (!showHandles && currentDrawingPath && path.id === currentDrawingPath.id) {
          const isLastPoint = i === path.anchorPoints.length - 1;
          const isSecondToLast = i === path.anchorPoints.length - 2;
          // Show handles for the last point and the one before it
          showHandles = isLastPoint || (isSecondToLast && path.anchorPoints.length > 1);
        }
        
        if (showHandles) {
          this.renderHandle(point);
        }
      }
    }
  }

  /**
   * Render handles for an anchor point
   */
  private renderHandle(point: AnchorPoint): void {
    const handleInPos = point.handleIn ? HandleManager.getAbsoluteHandlePosition(point, true) : null;
    const handleOutPos = point.handleOut ? HandleManager.getAbsoluteHandlePosition(point, false) : null;

    // Draw handle lines
    this.ctx.strokeStyle = this.options.handleColor;
    this.ctx.lineWidth = 1;
    this.ctx.setLineDash([3, 3]);

    if (handleInPos && point.handleIn?.visible) {
      this.ctx.beginPath();
      this.ctx.moveTo(point.position.x, point.position.y);
      this.ctx.lineTo(handleInPos.x, handleInPos.y);
      this.ctx.stroke();
    }

    if (handleOutPos && point.handleOut?.visible) {
      this.ctx.beginPath();
      this.ctx.moveTo(point.position.x, point.position.y);
      this.ctx.lineTo(handleOutPos.x, handleOutPos.y);
      this.ctx.stroke();
    }

    this.ctx.setLineDash([]);

    // Draw handle control points
    const handleSize = 4;

    if (handleInPos && point.handleIn?.visible) {
      this.ctx.beginPath();
      this.ctx.arc(handleInPos.x, handleInPos.y, handleSize, 0, Math.PI * 2);
      this.ctx.fillStyle = this.options.handleColor;
      this.ctx.fill();
      this.ctx.strokeStyle = '#FFFFFF';
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
    }

    if (handleOutPos && point.handleOut?.visible) {
      this.ctx.beginPath();
      this.ctx.arc(handleOutPos.x, handleOutPos.y, handleSize, 0, Math.PI * 2);
      this.ctx.fillStyle = this.options.handleColor;
      this.ctx.fill();
      this.ctx.strokeStyle = '#FFFFFF';
      this.ctx.lineWidth = 1;
      this.ctx.stroke();
    }
  }

  /**
   * Render a preview line
   */
  renderPreviewLine(from: Point, to: Point): void {
    this.previewElements.line = { from, to };
  }

  /**
   * Render a preview curve (cubic Bezier)
   */
  renderPreviewCurve(startPoint: Point, controlPoint1: Point, controlPoint2: Point, endPoint: Point): void {
    this.previewElements.curve = { start: startPoint, control1: controlPoint1, control2: controlPoint2, end: endPoint };
  }

  /**
   * Render close path indicator
   */
  renderClosePathIndicator(point: Point, show: boolean): void {
    this.previewElements.closeIndicator = { point, show };
  }

  /**
   * Render hover preview point for adding to paths
   */
  renderHoverPreviewPoint(point: Point | null): void {
    this.previewElements.hoverPoint = point;
  }

  /**
   * Render all preview elements
   */
  private renderPreviewElements(): void {
    // Render preview line
    if (this.previewElements.line) {
      const { from, to } = this.previewElements.line;
      this.ctx.beginPath();
      this.ctx.moveTo(from.x, from.y);
      this.ctx.lineTo(to.x, to.y);
      this.ctx.strokeStyle = this.options.previewColor;
      this.ctx.lineWidth = 1;
      this.ctx.setLineDash([5, 5]);
      this.ctx.stroke();
      this.ctx.setLineDash([]);
    }

    // Render preview curve
    if (this.previewElements.curve) {
      const { start, control1, control2, end } = this.previewElements.curve;
      this.ctx.beginPath();
      this.ctx.moveTo(start.x, start.y);
      this.ctx.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
      this.ctx.strokeStyle = this.options.previewColor;
      this.ctx.lineWidth = 1;
      this.ctx.setLineDash([5, 5]);
      this.ctx.stroke();
      this.ctx.setLineDash([]);
    }

    // Render close path indicator
    if (this.previewElements.closeIndicator?.show) {
      const { point } = this.previewElements.closeIndicator;
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, 8, 0, Math.PI * 2);
      this.ctx.strokeStyle = this.options.selectionColor;
      this.ctx.lineWidth = 2;
      this.ctx.stroke();
    }

    // Render hover preview point
    if (this.previewElements.hoverPoint) {
      const point = this.previewElements.hoverPoint;
      this.ctx.beginPath();
      this.ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
      this.ctx.fillStyle = this.options.selectionColor;
      this.ctx.globalAlpha = 0.5;
      this.ctx.fill();
      this.ctx.globalAlpha = 1;
      this.ctx.strokeStyle = this.options.selectionColor;
      this.ctx.lineWidth = 1.5;
      this.ctx.stroke();
    }
  }

  /**
   * Update the entire view
   */
  update(pathManager: PathManager, currentDrawingPath?: VectorPath | null): void {
    // Clear canvas
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);

    // Render in order: paths, handles, anchor points, preview
    this.renderPaths(pathManager);
    this.renderHandles(pathManager, currentDrawingPath);
    this.renderAnchorPoints(pathManager);
    this.renderPreviewElements();
  }

  /**
   * Clear all rendered elements
   */
  clear(): void {
    const rect = this.canvas.getBoundingClientRect();
    this.ctx.clearRect(0, 0, rect.width, rect.height);
    this.previewElements = {};
  }

  /**
   * Clear preview elements only
   */
  clearPreview(): void {
    this.previewElements = {};
  }

  /**
   * Clear all interactive elements (preview only for canvas)
   * Canvas renders anchor points and handles on-demand, not persistently
   */
  clearInteractive(): void {
    this.previewElements = {};
  }

  /**
   * Render in view-only mode (paths only, no interactive elements)
   */
  renderViewOnly(pathManager: PathManager): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    
    const paths = pathManager.getAllPaths();
    for (const path of paths) {
      this.renderPath(path, pathManager);
    }
    
    this.clearInteractive();
  }

  /**
   * Set render options
   */
  setOptions(options: Partial<RenderOptions>): void {
    Object.assign(this.options, options);
  }

  /**
   * Get the canvas element
   */
  getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  /**
   * Get the 2D context
   */
  getContext(): CanvasRenderingContext2D {
    return this.ctx;
  }
}
