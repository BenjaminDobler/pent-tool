import { Component, signal, computed, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { 
  PathManager, 
  PenTool, 
  EditMode, 
  PathRenderer,
  PenToolState,
  VectorPath,
  AnchorPoint,
  Point
} from '../../../../src/index';

type ToolMode = 'pen' | 'edit' | 'view';

export interface PathInfo {
  id: string;
  path: VectorPath;
  svgPath: string;
  pointCount: number;
  closed: boolean;
}

@Component({
  selector: 'app-pen-tool',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './pen-tool.component.html',
  styleUrls: ['./pen-tool.component.scss']
})
export class PenToolComponent implements AfterViewInit {
  // ViewChild reference to canvas
  @ViewChild('canvas', { static: false }) canvasRef!: ElementRef<SVGSVGElement>;

  // Signals for reactive state
  mode = signal<ToolMode>('pen');
  toolState = signal<string>('IDLE');
  pathCount = signal<number>(0);
  currentPath = signal<VectorPath | null>(null);
  selectedPoints = signal<AnchorPoint[]>([]);
  pathVersion = signal<number>(0); // Increments on any path modification

  // Computed signal with all path information including SVG data
  paths = computed<PathInfo[]>(() => {
    // Trigger recomputation when pathCount or pathVersion changes
    this.pathCount();
    this.pathVersion();
    
    if (!this.pathManager) return [];
    
    return this.pathManager.getAllPaths().map(path => ({
      id: path.id,
      path: path,
      svgPath: this.pathManager.toSVGPath(path) || '',
      pointCount: path.anchorPoints.length,
      closed: path.closed
    }));
  });

  // Tool instances
  private pathManager!: PathManager;
  private renderer!: PathRenderer;
  private penTool!: PenTool;
  private editMode!: EditMode;

  constructor() {
    // Keyboard listeners will be set up after tools are initialized
  }

  ngAfterViewInit() {
    this.initializeTools();
    this.setupKeyboardListeners();
  }

  private initializeTools() {
    const svgElement = this.canvasRef.nativeElement;
    
    // Initialize path manager
    this.pathManager = new PathManager();

    // Initialize renderer (will auto-import existing paths from SVG)
    this.renderer = new PathRenderer(svgElement, this.pathManager, {
      showAllHandles: false
    });

    // Initialize pen tool
    this.penTool = new PenTool(this.pathManager, {}, {
      onPathModified: (path: VectorPath) => {
        this.renderer.update(this.pathManager, this.penTool.getCurrentPath());
        this.updateState();
      },
      onStateChange: (state: PenToolState) => {
        this.toolState.set(state.toUpperCase());
        this.updateState();
      },
      onClosePathHover: (canClose: boolean) => {
        if (canClose && this.penTool.getCurrentPath()) {
          const firstPoint = this.penTool.getCurrentPath()!.anchorPoints[0];
          this.renderer.renderClosePathIndicator(firstPoint.position, true);
        } else {
          this.renderer.renderClosePathIndicator({ x: 0, y: 0 }, false);
        }
      }
    });

    // Initialize edit mode
    this.editMode = new EditMode(this.pathManager, {
      onPathModified: (path: VectorPath) => {
        this.renderer.update(this.pathManager, null);
        this.updateState();
      },
      onSelectionChange: (points: AnchorPoint[]) => {
        this.selectedPoints.set(points);
        this.renderer.setOptions({ showAllHandles: points.length > 0 });
        this.renderer.update(this.pathManager, null);
      },
      onHoverPreview: (point: Point | null, path: VectorPath | null) => {
        this.renderer.renderHoverPreviewPoint(point);
      }
    });

    // Initial render
    this.renderer.update(this.pathManager, null);
    this.updateState();
  }

  private getMousePosition(event: MouseEvent): Point {
    if (!this.canvasRef) return { x: 0, y: 0 };
    const svg = this.canvasRef.nativeElement;
    const rect = svg.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  onMouseDown(event: MouseEvent) {
    if (!this.penTool || !this.editMode) return;
    if (this.mode() === 'view') return; // No interaction in view mode
    
    let pos = this.getMousePosition(event);
    
    if (this.mode() === 'pen') {
      // Apply angle snapping if Shift is pressed and we're drawing a line (not starting a curve)
      const path = this.penTool.getCurrentPath();
      if (path && path.anchorPoints.length > 0 && this.penTool.isShiftKeyPressed()) {
        const lastPoint = path.anchorPoints[path.anchorPoints.length - 1];
        // Only snap if the last point doesn't have a visible handleOut (i.e., we're drawing a line, not a curve)
        if (!lastPoint.handleOut?.visible) {
          pos = this.penTool.snapPositionToAngle(pos, lastPoint.position);
        }
      }
      this.penTool.onMouseDown(pos);
    } else {
      this.editMode.onMouseDown(pos);
    }
  }

  onMouseMove(event: MouseEvent) {
    if (!this.penTool || !this.editMode || !this.renderer) return;
    if (this.mode() === 'view') return; // No interaction in view mode
    
    let pos = this.getMousePosition(event);
    
    if (this.mode() === 'pen') {
      this.penTool.onMouseMove(pos);
      
      // Render preview line or curve if drawing
      const path = this.penTool.getCurrentPath();
      if (path && path.anchorPoints.length > 0 && this.penTool.getState() === PenToolState.Drawing) {
        const lastPoint = path.anchorPoints[path.anchorPoints.length - 1];
        
        // Apply angle snapping to preview position if Shift is pressed
        let previewPos = pos;
        if (this.penTool.isShiftKeyPressed() && !lastPoint.handleOut?.visible) {
          previewPos = this.penTool.snapPositionToAngle(pos, lastPoint.position);
        }
        
        // If last point has handleOut, show curve preview
        if (lastPoint.handleOut?.visible) {
          const handleOutPos = {
            x: lastPoint.position.x + lastPoint.handleOut.position.x,
            y: lastPoint.position.y + lastPoint.handleOut.position.y
          };
          // Use mouse position as control point 2 (curve comes straight into cursor)
          this.renderer.renderPreviewCurve(lastPoint.position, handleOutPos, previewPos, previewPos);
        } else {
          this.renderer.renderPreviewLine(lastPoint.position, previewPos);
        }
      }
    } else {
      this.editMode.onMouseMove(pos);
    }
  }

  onMouseUp(event: MouseEvent) {
    if (!this.penTool || !this.editMode) return;
    if (this.mode() === 'view') return; // No interaction in view mode
    
    let pos = this.getMousePosition(event);
    
    if (this.mode() === 'pen') {
      // Apply angle snapping if Shift is pressed and we're drawing a line (not creating a curve)
      const path = this.penTool.getCurrentPath();
      if (path && path.anchorPoints.length > 0 && this.penTool.isShiftKeyPressed()) {
        const lastPoint = path.anchorPoints[path.anchorPoints.length - 1];
        // Only snap if the last point doesn't have a visible handleOut (i.e., we're drawing a line, not a curve)
        if (!lastPoint.handleOut?.visible) {
          pos = this.penTool.snapPositionToAngle(pos, lastPoint.position);
        }
      }
      this.penTool.onMouseUp(pos);
    } else {
      this.editMode.onMouseUp(pos);
    }
  }

  onDoubleClick(event: MouseEvent) {
    if (!this.editMode) return;
    if (this.mode() === 'edit') {
      const pos = this.getMousePosition(event);
      this.editMode.onDoubleClick(pos);
    }
  }

  toggleMode() {
    if (!this.renderer || !this.pathManager || !this.penTool) return;
    
    // Cycle through modes: pen -> edit -> view -> pen
    if (this.mode() === 'pen') {
      this.mode.set('edit');
      this.toolState.set('EDIT MODE');
      this.renderer.setOptions({ showAllHandles: true });
      this.renderer.clearPreview();
      this.penTool.reset();
      this.renderer.update(this.pathManager, null);
    } else if (this.mode() === 'edit') {
      this.setViewMode();
      return;
    } else {
      // From view mode back to pen
      this.mode.set('pen');
      this.toolState.set('IDLE');
      this.renderer.setOptions({ showAllHandles: false });
      this.renderer.update(this.pathManager, this.penTool.getCurrentPath());
    }
    this.updateState();
  }
  
  getToggleModeText(): string {
    if (this.mode() === 'pen') return 'Switch to Edit Mode';
    if (this.mode() === 'edit') return 'Switch to View Mode';
    return 'Switch to Draw Mode';
  }

  setViewMode() {
    if (!this.renderer || !this.pathManager || !this.penTool) return;
    this.mode.set('view');
    this.toolState.set('VIEW MODE');
    this.penTool.reset();
    this.selectedPoints.set([]);
    this.renderer.renderViewOnly(this.pathManager);
  }

  clearAllPaths() {
    if (!this.pathManager || !this.renderer || !this.penTool) return;
    const paths = this.pathManager.getAllPaths();
    paths.forEach((path: VectorPath) => this.pathManager.removePath(path.id));
    this.renderer.clear();
    this.penTool.reset();
    this.updateState();
  }

  closeCurrentPath() {
    if (!this.penTool || !this.pathManager || !this.renderer) return;
    const path = this.penTool.getCurrentPath();
    if (path) {
      this.pathManager.closePath(path);
      this.renderer.update(this.pathManager, null);
      this.penTool.reset();
      this.updateState();
    }
  }

  canClosePath(): boolean {
    if (!this.penTool) return false;
    const path = this.penTool.getCurrentPath();
    return path !== null && path.anchorPoints.length > 2;
  }

  deletePath(pathId: string) {
    if (!this.pathManager || !this.renderer) return;
    this.pathManager.removePath(pathId);
    this.renderer.update(this.pathManager, this.mode() === 'pen' ? this.penTool.getCurrentPath() : null);
    this.updateState();
  }

  private updateState() {
    if (!this.pathManager || !this.penTool) return;
    this.pathCount.set(this.pathManager.getAllPaths().length);
    this.currentPath.set(this.penTool.getCurrentPath());
    this.pathVersion.update(v => v + 1); // Increment version to trigger path list update
  }

  private setupKeyboardListeners() {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (this.mode() === 'view') return; // No keyboard input in view mode
        
        // Prevent default for modifier keys during drawing
        if (e.key === 'Shift' || e.key === 'Alt') {
          e.preventDefault();
        }
        
        if (this.mode() === 'pen') {
          this.penTool.onKeyDown(e.key);
        } else if (this.mode() === 'edit') {
          this.editMode.onKeyDown(e.key);
        }
      });

      window.addEventListener('keyup', (e) => {
        if (this.mode() === 'view') return; // No keyboard input in view mode
        
        // Prevent default for modifier keys during drawing
        if (e.key === 'Shift' || e.key === 'Alt') {
          e.preventDefault();
        }
        
        if (this.mode() === 'pen') {
          this.penTool.onKeyUp(e.key);
        } else if (this.mode() === 'edit') {
          this.editMode.onKeyUp(e.key);
        }
      });
    }
  }
}
