// Shared per-client brick position map: keyed by brickId, holds the local
// post-raycast world position. Lives in its own module to keep setup.ts and
// flying-bricks.ts from importing each other.
export const brickPositions = new Map<
  number,
  { x: number; y: number; z: number }
>()
