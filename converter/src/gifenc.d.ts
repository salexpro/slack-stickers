declare module 'gifenc' {
  export interface GifEncoderInstance {
    writeFrame(
      index: Uint8Array | number[],
      width: number,
      height: number,
      opts?: { palette?: number[][]; delay?: number; transparent?: boolean }
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  }
  interface GifencModule {
    GIFEncoder(): GifEncoderInstance;
    quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number): number[][];
    applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][]): Uint8Array;
  }
  const gifenc: GifencModule;
  export default gifenc;
}
