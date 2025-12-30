import { Point, VectorPath, AnchorPoint, PenToolState, HandleMirrorMode } from '../core/types';
import { PathManager, PointUtils } from '../core/path';
import { HandleManager } from '../core/handles';

export interface PenToolOptions {
  /** Snap angle increment in degrees (default: 45) */
  snapAngle?: number;
  /** Distance threshold for closing paths (default: 10) */
  closePathThreshold?: number;
  /** Default handle length when dragging (default: 50) */
  defaultHandleLength?: number;
}

export interface PenToolCallbacks {
  /** Called when path is modified */
  onPathModified?: (path: VectorPath) => void;
  /** Called when state changes */
  onStateChange?: (state: PenToolState) => void;
  /** Called when cursor should show close-path indicator */
  onClosePathHover?: (canClose: boolean) => void;
}

/**
 * Main pen tool controller for interactive drawing
 */
export class PenTool {
  private pathManager: PathManager;
  private currentPath: VectorPath | null = null;
  private state: PenToolState = PenToolState.Idle;
  private options: Required<PenToolOptions>;
  private callbacks: PenToolCallbacks;

  // Interaction state
  private isDragging = false;
  private dragStartPoint: Point | null = null;
  private currentAnchorPoint: AnchorPoint | null = null;
  private isShiftPressed = false;
  private isAltPressed = false;

  constructor(
    pathManager: PathManager,
    options: PenToolOptions = {},
    callbacks: PenToolCallbacks = {}
  ) {
    this.pathManager = pathManager;
    this.options = {
      snapAngle: options.snapAngle ?? 45,
      closePathThreshold: options.closePathThreshold ?? 10,
      defaultHandleLength: options.defaultHandleLength ?? 50
    };
    this.callbacks = callbacks;
  }

  /**
   * Get current tool state
   */
  getState(): PenToolState {
    return this.state;
  }

  /**
   * Get current active path
   */
  getCurrentPath(): VectorPath | null {
    return this.currentPath;
  }

  /**
   * Check if Shift key is currently pressed
   */
  isShiftKeyPressed(): boolean {
    return this.isShiftPressed;
  }

  /**
   * Snap a position to the nearest angle relative to a reference point
   */
  snapPositionToAngle(position: Point, referencePoint: Point): Point {
    const delta = PointUtils.subtract(position, referencePoint);
    const snapped = this.snapToAngle(delta);
    return PointUtils.add(referencePoint, snapped);
  }

  /**
   * Handle mouse down event
   */
  onMouseDown(position: Point): void {
    if (this.state === PenToolState.EditMode) {
      return; // Handled by edit mode
    }

    this.isDragging = true;
    this.dragStartPoint = position;

    // Check if clicking near the start point to close path (only for current path)
    if (this.currentPath && this.currentPath.anchorPoints.length > 0) {
      const firstPoint = this.currentPath.anchorPoints[0];
      const distance = PointUtils.distance(position, firstPoint.position);

      if (distance <= this.options.closePathThreshold) {
        // Close the path
        this.pathManager.closePath(this.currentPath);
        this.notifyPathModified();
        this.finishPath();
        return;
      }
    }

    // If no current path, check if clicking on an endpoint of any existing open path to continue it
    if (!this.currentPath) {
      const allPaths = this.pathManager.getAllPaths();
      for (const path of allPaths) {
        if (!path.closed && path.anchorPoints.length > 0) {
          const firstPoint = path.anchorPoints[0];
          const lastPoint = path.anchorPoints[path.anchorPoints.length - 1];
          
          const distanceToFirst = PointUtils.distance(position, firstPoint.position);
          const distanceToLast = PointUtils.distance(position, lastPoint.position);
          
          // Check if clicking on the last point (end of path) to continue
          if (distanceToLast <= this.options.closePathThreshold) {
            this.currentPath = path;
            this.setState(PenToolState.Drawing);
            this.isDragging = false;
            this.dragStartPoint = null;
            return;
          }
          
          // Check if clicking on the first point (start of path) to continue from the beginning
          if (distanceToFirst <= this.options.closePathThreshold) {
            this.currentPath = path;
            // Reverse the path so we add points at what was the start
            this.reversePathDirection(path);
            this.setState(PenToolState.Drawing);
            this.isDragging = false;
            this.dragStartPoint = null;
            this.notifyPathModified();
            return;
          }
        }
      }
      
      // No endpoint clicked, start a new path
      this.currentPath = this.pathManager.createPath();
      this.setState(PenToolState.Drawing);
    }
  }

  /**
   * Reverse the direction of a path (swap start and end, flip handles)
   */
  private reversePathDirection(path: VectorPath): void {
    // Reverse the order of anchor points
    path.anchorPoints.reverse();
    
    // Swap handleIn and handleOut for each point
    for (const point of path.anchorPoints) {
      const tempHandle = point.handleIn;
      point.handleIn = point.handleOut;
      point.handleOut = tempHandle;
      
      // Flip the handle directions (negate x and y)
      if (point.handleIn) {
        point.handleIn.position.x = -point.handleIn.position.x;
        point.handleIn.position.y = -point.handleIn.position.y;
      }
      if (point.handleOut) {
        point.handleOut.position.x = -point.handleOut.position.x;
        point.handleOut.position.y = -point.handleOut.position.y;
      }
    }
  }  /**
   * Handle mouse move event
   */
  onMouseMove(position: Point): void {
    // Check for close path hover
    if (this.currentPath && this.currentPath.anchorPoints.length > 0) {
      const firstPoint = this.currentPath.anchorPoints[0];
      const distance = PointUtils.distance(position, firstPoint.position);
      const canClose = distance <= this.options.closePathThreshold;

      if (this.callbacks.onClosePathHover) {
        this.callbacks.onClosePathHover(canClose);
      }
    }

    if (this.isDragging && this.dragStartPoint && this.currentPath) {
      this.setState(PenToolState.DraggingHandle);

      // Calculate handle position
      let handlePosition = PointUtils.subtract(position, this.dragStartPoint);

      // Apply angle snapping if shift is pressed
      if (this.isShiftPressed) {
        handlePosition = this.snapToAngle(handlePosition);
      }

      // Update or create the current anchor point with handles
      if (!this.currentAnchorPoint) {
        this.currentAnchorPoint = this.pathManager.addAnchorPoint(
          this.currentPath,
          this.dragStartPoint,
          null,
          handlePosition
        );
        // Set to independent mode if Alt is pressed
        if (this.isAltPressed) {
          this.currentAnchorPoint.mirrorMode = HandleMirrorMode.Independent;
        }
      } else {
        // Temporarily set to independent mode if Alt is pressed
        const originalMode = this.currentAnchorPoint.mirrorMode;
        if (this.isAltPressed) {
          this.currentAnchorPoint.mirrorMode = HandleMirrorMode.Independent;
        }
        HandleManager.updateHandle(this.currentAnchorPoint, true, position);
        if (this.isAltPressed) {
          this.currentAnchorPoint.mirrorMode = originalMode;
        }
      }

      this.notifyPathModified();
    }
  }

  /**
   * Handle mouse up event
   */
  onMouseUp(position: Point): void {
    if (!this.isDragging || !this.dragStartPoint || !this.currentPath) {
      return;
    }

    const dragDistance = PointUtils.distance(this.dragStartPoint, position);

    if (dragDistance < 2) {
      // Click without drag - add straight line point
      if (!this.currentAnchorPoint) {
        this.currentAnchorPoint = this.pathManager.addAnchorPoint(
          this.currentPath,
          this.dragStartPoint,
          null,
          null
        );
        this.notifyPathModified();
      }
    } else {
      // Dragged - the anchor point with handles was already created/updated
      // Just finalize the state
    }

    // Reset for next point
    this.isDragging = false;
    this.dragStartPoint = null;
    this.currentAnchorPoint = null;
    this.setState(PenToolState.Drawing);
  }

  /**
   * Handle keyboard down event
   */
  onKeyDown(key: string): void {
    if (key === 'Shift') {
      this.isShiftPressed = true;
    } else if (key === 'Alt') {
      this.isAltPressed = true;
    } else if (key === 'Escape') {
      this.finishPath();
    } else if (key === 'Enter') {
      if (this.currentPath) {
        this.pathManager.closePath(this.currentPath);
        this.notifyPathModified();
        this.finishPath();
      }
    }
  }

  /**
   * Handle keyboard up event
   */
  onKeyUp(key: string): void {
    if (key === 'Shift') {
      this.isShiftPressed = false;
    } else if (key === 'Alt') {
      this.isAltPressed = false;
    }
  }

  /**
   * Add a point to an existing path segment
   */
  addPointToPath(path: VectorPath, segmentIndex: number, t: number): AnchorPoint {
    const segments = this.pathManager.getSegments(path);
    if (segmentIndex < 0 || segmentIndex >= segments.length) {
      throw new Error('Invalid segment index');
    }

    const segment = segments[segmentIndex];
    let newPosition: Point;

    if (segment.type === 'line') {
      // Linear interpolation for straight lines
      const t1 = 1 - t;
      newPosition = {
        x: t1 * segment.startPoint.position.x + t * segment.endPoint.position.x,
        y: t1 * segment.startPoint.position.y + t * segment.endPoint.position.y
      };
    } else {
      // Cubic Bezier interpolation for curves
      newPosition = PathManager.cubicBezierPoint(
        segment.startPoint.position,
        segment.controlPoint1!,
        segment.controlPoint2!,
        segment.endPoint.position,
        t
      );
    }

    // Insert the new point
    const newPoint = this.pathManager.insertAnchorPoint(
      path,
      segmentIndex + 1,
      newPosition
    );

    // Create default handles based on adjacent points
    const prevPoint = path.anchorPoints[segmentIndex];
    const nextPoint = path.anchorPoints[(segmentIndex + 2) % path.anchorPoints.length];

    HandleManager.createDefaultHandles(
      newPoint,
      prevPoint.position,
      nextPoint.position,
      this.options.defaultHandleLength
    );

    this.notifyPathModified();
    return newPoint;
  }

  /**
   * Finish the current path and reset state
   */
  private finishPath(): void {
    this.currentPath = null;
    this.currentAnchorPoint = null;
    this.isDragging = false;
    this.dragStartPoint = null;
    this.setState(PenToolState.Idle);
  }

  /**
   * Snap a vector to the nearest angle increment
   */
  private snapToAngle(vector: Point): Point {
    const angle = Math.atan2(vector.y, vector.x);
    const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y);
    const snapRadians = (this.options.snapAngle * Math.PI) / 180;
    const snappedAngle = Math.round(angle / snapRadians) * snapRadians;

    return {
      x: Math.cos(snappedAngle) * length,
      y: Math.sin(snappedAngle) * length
    };
  }

  /**
   * Set tool state and notify callback
   */
  private setState(newState: PenToolState): void {
    if (this.state !== newState) {
      this.state = newState;
      if (this.callbacks.onStateChange) {
        this.callbacks.onStateChange(newState);
      }
    }
  }

  /**
   * Notify that path was modified
   */
  private notifyPathModified(): void {
    if (this.currentPath && this.callbacks.onPathModified) {
      this.callbacks.onPathModified(this.currentPath);
    }
  }

  /**
   * Reset the tool
   */
  reset(): void {
    this.finishPath();
  }
}
