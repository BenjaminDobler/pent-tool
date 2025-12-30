import { VectorPath, AnchorPoint, Point } from '../core/types';
import { PathManager } from '../core/path';
import { HandleManager } from '../core/handles';
import { IPathRenderer, RenderOptions } from './IPathRenderer';

export type { RenderOptions } from './IPathRenderer';

/**
 * SVG renderer for paths, anchor points, handles, and UI feedback
 */
export class SvgPathRenderer implements IPathRenderer {
  private svg: SVGSVGElement;
  private pathsGroup: SVGGElement;
  private anchorPointsGroup: SVGGElement;
  private handlesGroup: SVGGElement;
  private previewGroup: SVGGElement;
  private options: Required<RenderOptions>;
  private pathManager: PathManager | null = null;
  private pathVersions: Map<string, number> = new Map(); // Track path versions for change detection

  constructor(svg: SVGSVGElement, pathManager?: PathManager, options: RenderOptions = {}) {
    this.svg = svg;
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

    // Create layer groups
    this.pathsGroup = this.createGroup('paths');
    this.handlesGroup = this.createGroup('handles');
    this.anchorPointsGroup = this.createGroup('anchor-points');
    this.previewGroup = this.createGroup('preview');

    // Auto-import existing paths if enabled
    if (pathManager && this.options.autoImport) {
      this.pathManager = pathManager;
      this.autoImportExistingPaths();
    }
  }

  /**
   * Automatically import existing path elements from the SVG
   */
  private autoImportExistingPaths(): void {
    if (!this.pathManager) return;

    const existingPaths = this.svg.querySelectorAll('path');
    if (existingPaths.length === 0) return;

    existingPaths.forEach(pathElement => {
      const d = pathElement.getAttribute('d');
      if (d) {
        this.pathManager!.importFromSVG(d, {
          stroke: pathElement.getAttribute('stroke') || undefined,
          strokeWidth: parseFloat(pathElement.getAttribute('stroke-width') || '2'),
          fill: pathElement.getAttribute('fill') || undefined
        });
        // Remove the original path element since we'll render our own
        pathElement.remove();
      }
    });

    // Render the imported paths
    this.renderPaths(this.pathManager);
  }

  /**
   * Render all paths (optimized to only update changed paths)
   */
  renderPaths(pathManager: PathManager): void {
    const paths = pathManager.getAllPaths();
    const currentPathIds = new Set(paths.map(p => p.id));
    
    // Remove paths that no longer exist
    const existingElements = this.pathsGroup.querySelectorAll('[data-path-id]');
    existingElements.forEach(element => {
      const pathId = element.getAttribute('data-path-id');
      if (pathId && !currentPathIds.has(pathId)) {
        element.remove();
        this.pathVersions.delete(pathId);
      }
    });

    // Update or create paths
    for (const path of paths) {
      const pathVersion = this.getPathVersion(path);
      const existingVersion = this.pathVersions.get(path.id);
      
      if (existingVersion !== pathVersion) {
        // Path has changed or is new - update it
        this.updateOrCreatePath(path, pathManager);
        this.pathVersions.set(path.id, pathVersion);
      }
    }
  }

  /**
   * Calculate a version number for a path based on its content
   */
  private getPathVersion(path: VectorPath): number {
    let hash = 0;
    
    // Include basic path properties
    hash ^= path.closed ? 1 : 0;
    hash ^= path.anchorPoints.length << 1;
    
    // Include anchor point positions and handle states
    for (let i = 0; i < path.anchorPoints.length; i++) {
      const point = path.anchorPoints[i];
      hash ^= (point.position.x * 31 + point.position.y) * (i + 1);
      
      if (point.handleIn?.visible) {
        hash ^= (point.handleIn.position.x * 17 + point.handleIn.position.y) * (i + 1000);
      }
      if (point.handleOut?.visible) {
        hash ^= (point.handleOut.position.x * 19 + point.handleOut.position.y) * (i + 2000);
      }
    }
    
    // Include styling
    if (path.stroke) hash ^= path.stroke.length * 13;
    if (path.fill) hash ^= path.fill.length * 23;
    hash ^= path.strokeWidth * 29;
    hash ^= path.selected ? 4096 : 0;
    
    return hash;
  }

  /**
   * Update an existing path element or create a new one
   */
  private updateOrCreatePath(path: VectorPath, pathManager: PathManager): void {
    const pathData = pathManager.toSVGPath(path);
    if (!pathData) return;

    let pathElement = this.pathsGroup.querySelector(`[data-path-id="${path.id}"]`) as SVGPathElement;
    
    if (!pathElement) {
      // Create new path element
      pathElement = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      pathElement.setAttribute('data-path-id', path.id);
      this.pathsGroup.appendChild(pathElement);
    }
    
    // Update attributes
    pathElement.setAttribute('d', pathData);
    pathElement.setAttribute('stroke', path.stroke || this.options.strokeColor);
    pathElement.setAttribute('stroke-width', path.strokeWidth.toString());
    pathElement.setAttribute('fill', path.fill || this.options.fillColor);
    
    if (path.selected) {
      pathElement.setAttribute('stroke', this.options.selectionColor);
    }
  }

  /**
   * Render anchor points for all paths
   */
  renderAnchorPoints(pathManager: PathManager): void {
    this.anchorPointsGroup.innerHTML = '';

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
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', point.position.x.toString());
    circle.setAttribute('cy', point.position.y.toString());
    circle.setAttribute('r', this.options.anchorPointSize.toString());
    circle.setAttribute('fill', this.options.anchorPointColor);
    circle.setAttribute('stroke', point.selected ? this.options.selectionColor : '#000000');
    circle.setAttribute('stroke-width', '1.5');
    circle.setAttribute('data-point-id', point.id);

    this.anchorPointsGroup.appendChild(circle);
  }

  /**
   * Render handles for anchor points
   */
  renderHandles(pathManager: PathManager, currentDrawingPath?: VectorPath | null): void {
    this.handlesGroup.innerHTML = '';

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
          this.renderPointHandles(point);
        }
      }
    }
  }

  /**
   * Render handles for a specific anchor point
   */
  private renderPointHandles(point: AnchorPoint): void {
    // Render handle in
    if (point.handleIn?.visible) {
      const handlePos = HandleManager.getAbsoluteHandlePosition(point, false);
      if (handlePos) {
        this.renderHandle(point.position, handlePos, 'in', point.id);
      }
    }

    // Render handle out
    if (point.handleOut?.visible) {
      const handlePos = HandleManager.getAbsoluteHandlePosition(point, true);
      if (handlePos) {
        this.renderHandle(point.position, handlePos, 'out', point.id);
      }
    }
  }

  /**
   * Render a single handle
   */
  private renderHandle(
    anchorPos: Point,
    handlePos: Point,
    type: 'in' | 'out',
    pointId: string
  ): void {
    // Handle line
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', anchorPos.x.toString());
    line.setAttribute('y1', anchorPos.y.toString());
    line.setAttribute('x2', handlePos.x.toString());
    line.setAttribute('y2', handlePos.y.toString());
    line.setAttribute('stroke', this.options.handleColor);
    line.setAttribute('stroke-width', '1');
    line.setAttribute('data-handle-type', type);
    line.setAttribute('data-point-id', pointId);

    this.handlesGroup.appendChild(line);

    // Handle endpoint
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', handlePos.x.toString());
    circle.setAttribute('cy', handlePos.y.toString());
    circle.setAttribute('r', '4');
    circle.setAttribute('fill', this.options.handleColor);
    circle.setAttribute('stroke', '#FFFFFF');
    circle.setAttribute('stroke-width', '1.5');
    circle.setAttribute('data-handle-type', type);
    circle.setAttribute('data-point-id', pointId);

    this.handlesGroup.appendChild(circle);
  }

  /**
   * Render preview line from last point to cursor
   */
  renderPreviewLine(fromPoint: Point, toPoint: Point): void {
    this.previewGroup.innerHTML = '';

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', fromPoint.x.toString());
    line.setAttribute('y1', fromPoint.y.toString());
    line.setAttribute('x2', toPoint.x.toString());
    line.setAttribute('y2', toPoint.y.toString());
    line.setAttribute('stroke', this.options.previewColor);
    line.setAttribute('stroke-width', '1');
    line.setAttribute('stroke-dasharray', '4 4');

    this.previewGroup.appendChild(line);
  }

  /**
   * Render preview curve while dragging handle
   */
  renderPreviewCurve(
    startPoint: Point,
    controlPoint1: Point,
    controlPoint2: Point,
    endPoint: Point
  ): void {
    this.previewGroup.innerHTML = '';

    const pathData = `M ${startPoint.x} ${startPoint.y} C ${controlPoint1.x} ${controlPoint1.y}, ${controlPoint2.x} ${controlPoint2.y}, ${endPoint.x} ${endPoint.y}`;

    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathData);
    path.setAttribute('stroke', this.options.previewColor);
    path.setAttribute('stroke-width', '1');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-dasharray', '4 4');

    this.previewGroup.appendChild(path);
  }

  /**
   * Clear preview elements
   */
  clearPreview(): void {
    this.previewGroup.innerHTML = '';
  }

  /**
   * Clear all interactive elements (anchor points, handles, preview)
   * Useful for view-only mode
   */
  clearInteractive(): void {
    this.anchorPointsGroup.innerHTML = '';
    this.handlesGroup.innerHTML = '';
    this.previewGroup.innerHTML = '';
  }

  /**
   * Render in view-only mode (paths only, no interactive elements)
   */
  renderViewOnly(pathManager: PathManager): void {
    this.renderPaths(pathManager);
    this.clearInteractive();
  }

  /**
   * Render close-path indicator
   */
  renderClosePathIndicator(point: Point, show: boolean): void {
    const indicatorId = 'close-path-indicator';
    const existing = this.svg.getElementById(indicatorId);

    if (!show) {
      if (existing) {
        existing.remove();
      }
      return;
    }

    if (!existing) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('id', indicatorId);
      circle.setAttribute('r', '8');
      circle.setAttribute('fill', 'none');
      circle.setAttribute('stroke', this.options.selectionColor);
      circle.setAttribute('stroke-width', '2');
      this.previewGroup.appendChild(circle);
    }

    const indicator = this.svg.getElementById(indicatorId);
    if (indicator) {
      indicator.setAttribute('cx', point.x.toString());
      indicator.setAttribute('cy', point.y.toString());
    }
  }

  /**
   * Render hover preview point for adding to paths
   */
  renderHoverPreviewPoint(point: Point | null): void {
    const previewId = 'hover-preview-point';
    const existing = this.svg.getElementById(previewId);

    if (!point) {
      if (existing) {
        existing.remove();
      }
      return;
    }

    if (!existing) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('id', previewId);
      circle.setAttribute('r', '4');
      circle.setAttribute('fill', this.options.selectionColor);
      circle.setAttribute('fill-opacity', '0.5');
      circle.setAttribute('stroke', this.options.selectionColor);
      circle.setAttribute('stroke-width', '1.5');
      circle.setAttribute('pointer-events', 'none');
      this.previewGroup.appendChild(circle);
    }

    const preview = this.svg.getElementById(previewId);
    if (preview) {
      preview.setAttribute('cx', point.x.toString());
      preview.setAttribute('cy', point.y.toString());
    }
  }

  /**
   * Update the entire view
   */
  update(pathManager: PathManager, currentDrawingPath?: VectorPath | null): void {
    this.renderPaths(pathManager);
    this.renderHandles(pathManager, currentDrawingPath);
    this.renderAnchorPoints(pathManager);
  }

  /**
   * Clear all rendered elements
   */
  clear(): void {
    this.pathsGroup.innerHTML = '';
    this.anchorPointsGroup.innerHTML = '';
    this.handlesGroup.innerHTML = '';
    this.previewGroup.innerHTML = '';
  }

  /**
   * Create an SVG group element
   */
  private createGroup(className: string): SVGGElement {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', className);
    this.svg.appendChild(group);
    return group;
  }

  /**
   * Set render options
   */
  setOptions(options: Partial<RenderOptions>): void {
    Object.assign(this.options, options);
  }
}
