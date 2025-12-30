# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-12-30

### Added
- Initial release of @richapps/pen-tool
- Figma-style pen tool for creating and editing SVG paths with Bezier curves
- Drawing mode: Click to add straight points, click-and-drag to create curves
- Edit mode: Move anchor points, adjust Bezier handles, add/delete points
- View mode: Display paths without any interactive control elements
- Auto-import existing SVG paths from DOM elements
- Smart point addition with hover preview indicator
- Perfect curve subdivision using De Casteljau's algorithm
- Three handle mirroring modes: Mirrored, Angle-locked, Independent
- Dual renderers: SVG (DOM-based) and Canvas 2D (performance-optimized)
- Keyboard modifiers: Shift for angle snapping, Alt for independent handles
- Real-time visual feedback with handles, preview lines, and selection
- TypeScript support with full type definitions
- Comprehensive documentation and examples

### Performance
- Incremental DOM updates - only modified paths are re-rendered
- Path version tracking with hash-based change detection
- Efficient DOM element reuse

### Features
- Curved preview line when drawing from points with handles
- Interactive UI with close-path indicators
- Path closing detection and snap-to-first-point
- Keyboard shortcuts for all major operations
- Support for SVG import/export
- Angular integration example included

[0.1.0]: https://github.com/BenjaminDobler/pent-tool/releases/tag/v0.1.0
