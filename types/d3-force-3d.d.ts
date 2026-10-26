// d3-force-3d ships no types; only the forces the constitution map uses are declared.
declare module "d3-force-3d" {
  type NodeNumber<N> = number | ((node: N, index: number, nodes: N[]) => number);

  interface Force<N> {
    (alpha: number): void;
    initialize?: (nodes: N[], ...args: unknown[]) => void;
  }

  export interface CollideForce<N> extends Force<N> {
    radius(radius: NodeNumber<N>): this;
    strength(strength: number): this;
    iterations(iterations: number): this;
  }

  export interface PositionForce<N> extends Force<N> {
    strength(strength: NodeNumber<N>): this;
    x(x: NodeNumber<N>): this;
    y(y: NodeNumber<N>): this;
    z(z: NodeNumber<N>): this;
  }

  export function forceCollide<N = unknown>(radius?: NodeNumber<N>): CollideForce<N>;
  export function forceX<N = unknown>(x?: NodeNumber<N>): PositionForce<N>;
  export function forceY<N = unknown>(y?: NodeNumber<N>): PositionForce<N>;
  export function forceZ<N = unknown>(z?: NodeNumber<N>): PositionForce<N>;
}
