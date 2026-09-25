import type { PlacedSection } from '../timing';

export interface SceneProps { placed: PlacedSection; variant?: string }
export type SceneComponent = React.FC<SceneProps>;
