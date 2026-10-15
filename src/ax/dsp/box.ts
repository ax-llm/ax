import { ValidationError } from './errors.js';

/** Bounding box edges normalized to [0, 1], measured from the image's top-left. */
export type AxBox = {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
};

/** @internal Validate coordinates without clamping or changing the prediction. */
export function validateBox(value: unknown, path: string): AxBox {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ValidationError(`Invalid box for ${path}: expected four edges`);
  const box = value as Record<string, unknown>;
  const edges = ['top', 'bottom', 'left', 'right'] as const;
  if (
    Object.keys(box).length !== edges.length ||
    edges.some((edge) => {
      const v = box[edge];
      return typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1;
    })
  )
    throw new ValidationError(
      `Invalid box for ${path}: edges must be finite numbers in [0, 1]`
    );
  if (
    (box.top as number) >= (box.bottom as number) ||
    (box.left as number) >= (box.right as number)
  )
    throw new ValidationError(
      `Invalid box for ${path}: top < bottom and left < right are required`
    );
  return value as AxBox;
}

/** @internal JSON schema shared by native and generative box outputs. */
export function boxSchema(): Record<string, unknown> {
  const edges = ['top', 'bottom', 'left', 'right'];
  return {
    type: 'object',
    properties: Object.fromEntries(
      edges.map((edge) => [edge, { type: 'number', minimum: 0, maximum: 1 }])
    ),
    required: edges,
    additionalProperties: false,
  };
}
