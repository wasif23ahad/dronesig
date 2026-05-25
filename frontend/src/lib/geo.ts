import type { ImageCorners } from "@/types/detection";

export const DEFAULT_BOUNDS: [number, number, number, number] = [90.354, 23.778, 90.358, 23.782];

export const boundsToCorners = (bounds: [number, number, number, number]): ImageCorners => {
  const [swLng, swLat, neLng, neLat] = bounds;
  return [
    [swLng, neLat],
    [neLng, neLat],
    [neLng, swLat],
    [swLng, swLat],
  ];
};

export const cornersToBounds = (corners: ImageCorners): [number, number, number, number] => {
  const lngs = corners.map((corner) => corner[0]);
  const lats = corners.map((corner) => corner[1]);
  return [
    Math.min(...lngs),
    Math.min(...lats),
    Math.max(...lngs),
    Math.max(...lats),
  ];
};

const solveLinearSystem = (matrix: number[][], values: number[]): number[] => {
  const size = values.length;
  const a = matrix.map((row) => [...row]);
  const b = [...values];

  for (let col = 0; col < size; col += 1) {
    let pivotRow = col;
    for (let row = col + 1; row < size; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivotRow][col])) {
        pivotRow = row;
      }
    }

    const pivot = a[pivotRow][col];
    if (Math.abs(pivot) < 1e-12) {
      throw new Error("Singular matrix");
    }

    if (pivotRow !== col) {
      [a[col], a[pivotRow]] = [a[pivotRow], a[col]];
      [b[col], b[pivotRow]] = [b[pivotRow], b[col]];
    }

    const divisor = a[col][col];
    for (let k = col; k < size; k += 1) {
      a[col][k] /= divisor;
    }
    b[col] /= divisor;

    for (let row = 0; row < size; row += 1) {
      if (row === col) {
        continue;
      }
      const factor = a[row][col];
      if (factor === 0) {
        continue;
      }
      for (let k = col; k < size; k += 1) {
        a[row][k] -= factor * a[col][k];
      }
      b[row] -= factor * b[col];
    }
  }

  return b;
};

export const computePixelToGeoHomography = (
  imageWidth: number,
  imageHeight: number,
  corners: ImageCorners
): number[] => {
  const srcPoints: [number, number][] = [
    [0, 0],
    [imageWidth, 0],
    [imageWidth, imageHeight],
    [0, imageHeight],
  ];

  const matrix: number[][] = [];
  const values: number[] = [];
  srcPoints.forEach(([x, y], index) => {
    const [lng, lat] = corners[index];
    matrix.push([x, y, 1, 0, 0, 0, -lng * x, -lng * y]);
    values.push(lng);
    matrix.push([0, 0, 0, x, y, 1, -lat * x, -lat * y]);
    values.push(lat);
  });

  return solveLinearSystem(matrix, values);
};

export const projectPixelToGeo = (x: number, y: number, homography: number[]): [number, number] => {
  const [h11, h12, h13, h21, h22, h23, h31, h32] = homography;
  const denom = h31 * x + h32 * y + 1;
  if (Math.abs(denom) < 1e-12) {
    throw new Error("Invalid homography denominator");
  }
  const lng = (h11 * x + h12 * y + h13) / denom;
  const lat = (h21 * x + h22 * y + h23) / denom;
  return [lng, lat];
};
