import { Component, signal, ElementRef, ViewChild, AfterViewInit } from '@angular/core';
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

type ToolMode = 'pen' | 'edit';

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

  // Tool instances
  private pathManager!: PathManager;
  private renderer!: PathRenderer;
  private penTool!: PenTool;
  private editMode!: EditMode;

  constructor() {
    // Setup keyboard listeners
    this.setupKeyboardListeners();
  }

  ngAfterViewInit() {
    this.initializeTools();
  }

  private initializeTools() {
    const svgElement = this.canvasRef.nativeElement;
    
    // Initialize path manager
    this.pathManager = new PathManager();

    // Initialize renderer
    this.renderer = new PathRenderer(svgElement, {
      showAllHandles: false
    });

    // Initialize pen tool
    this.penTool = new PenTool(this.pathManager, {}, {
      onPathModified: (path: VectorPath) => {
        this.renderer.update(this.pathManager);
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
        this.renderer.update(this.pathManager);
        this.updateState();
      },
      onSelectionChange: (points: AnchorPoint[]) => {
        this.selectedPoints.set(points);
        this.renderer.setOptions({ showAllHandles: points.length > 0 });
        this.renderer.update(this.pathManager);
      }
    });

    // Initial render
    this.renderer.update(this.pathManager);
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
    const pos = this.getMousePosition(event);
    
    if (this.mode() === 'pen') {
      this.penTool.onMouseDown(pos);
    } else {
      this.editMode.onMouseDown(pos);
    }
  }

  onMouseMove(event: MouseEvent) {
    if (!this.penTool || !this.editMode || !this.renderer) return;
    const pos = this.getMousePosition(event);
    
    if (this.mode() === 'pen') {
      this.penTool.onMouseMove(pos);
      
      // Render preview line if drawing
      const path = this.penTool.getCurrentPath();
      if (path && path.anchorPoints.length > 0 && this.penTool.getState() === PenToolState.Drawing) {
        const lastPoint = path.anchorPoints[path.anchorPoints.length - 1];
        this.renderer.renderPreviewLine(lastPoint.position, pos);
      }
    } else {
      this.editMode.onMouseMove(pos);
    }
  }

  onMouseUp(event: MouseEvent) {
    if (!this.penTool || !this.editMode) return;
    const pos = this.getMousePosition(event);
    
    if (this.mode() === 'pen') {
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
    if (this.mode() === 'pen') {
      this.mode.set('edit');
      this.toolState.set('EDIT MODE');
      this.renderer.setOptions({ showAllHandles: true });
      this.renderer.clearPreview();
      this.penTool.reset();
    } else {
      this.mode.set('pen');
      this.toolState.set('IDLE');
      this.renderer.setOptions({ showAllHandles: false });
    }
    this.renderer.update(this.pathManager);
    this.updateState();
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
      this.renderer.update(this.pathManager);
      this.penTool.reset();
      this.updateState();
    }
  }

  canClosePath(): boolean {
    if (!this.penTool) return false;
    const path = this.penTool.getCurrentPath();
    return path !== null && path.anchorPoints.length > 2;
  }

  private updateState() {
    if (!this.pathManager || !this.penTool) return;
    this.pathCount.set(this.pathManager.getAllPaths().length);
    this.currentPath.set(this.penTool.getCurrentPath());
  }

  private setupKeyboardListeners() {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (this.mode() === 'pen') {
          this.penTool.onKeyDown(e.key);
        } else {
          this.editMode.onKeyDown(e.key);
        }
      });

      window.addEventListener('keyup', (e) => {
        if (this.mode() === 'pen') {
          this.penTool.onKeyUp(e.key);
        } else {
          this.editMode.onKeyUp(e.key);
        }
      });
    }
  }
}
