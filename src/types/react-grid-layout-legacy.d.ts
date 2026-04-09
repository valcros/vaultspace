declare module 'react-grid-layout/legacy' {
  import type { WidthProvider as WP } from 'react-grid-layout';

  export const WidthProvider: typeof WP;

  // The legacy default export is the v1 ReactGridLayout component
  const GridLayout: typeof import('react-grid-layout');
  export default GridLayout;
}
