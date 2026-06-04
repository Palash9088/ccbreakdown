/**
 * pdfjs-dist expects browser globals at module load. Install stubs (and optionally
 * @napi-rs/canvas) before importing pdfjs on Vercel/serverless Node.
 */
let _ready: Promise<void> | null = null;

function installStubs(): void {
  const g = globalThis as Record<string, unknown>;

  if (typeof g.DOMMatrix === "undefined") {
    g.DOMMatrix = class DOMMatrix {
      a = 1;
      b = 0;
      c = 0;
      d = 1;
      e = 0;
      f = 0;
      is2D = true;
      isIdentity = true;
      transformPoint(p?: { x: number; y: number }) {
        return p ?? { x: 0, y: 0 };
      }
      multiply() {
        return new (g.DOMMatrix as new () => InstanceType<typeof DOMMatrix>)();
      }
      translate() {
        return new (g.DOMMatrix as new () => InstanceType<typeof DOMMatrix>)();
      }
      scale() {
        return new (g.DOMMatrix as new () => InstanceType<typeof DOMMatrix>)();
      }
    };
  }

  if (typeof g.Path2D === "undefined") {
    g.Path2D = class Path2D {};
  }

  if (typeof g.ImageData === "undefined") {
    g.ImageData = class ImageData {
      width: number;
      height: number;
      data: Uint8ClampedArray;
      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
        this.data = new Uint8ClampedArray(width * height * 4);
      }
    };
  }
}

export function ensurePdfNodeGlobals(): Promise<void> {
  if (!_ready) {
    _ready = (async () => {
      installStubs();
      try {
        await import("@napi-rs/canvas");
      } catch {
        // Stubs are enough for text extraction when native canvas is unavailable.
      }
    })();
  }
  return _ready;
}

// Run stubs synchronously as soon as this module loads (before pdfjs import).
installStubs();
