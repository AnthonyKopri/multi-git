// Lane assignment for the commit graph.
//
// Straight-lane layout over topologically ordered commits. Each lane "waits"
// for a commit hash; a commit lands on the first lane waiting for it (a new
// tip opens a lane), its first parent continues that lane, extra parents fork
// out, and other lanes waiting for the same hash merge in.
//
// The layout is *resumable*. The previous version recomputed every row from
// scratch on each page load, so with 200 commits per page, loading page N
// re-laid-out N x 200 commits and rebuilt every row's DOM. Threading the lane
// state out means a new page lays out only its own commits.
import type { Commit } from '../../../shared/git-types';

export const GRAPH_LANE_COLOR_COUNT = 8;
export const GRAPH_LANE_WIDTH = 14;
export const GRAPH_ROW_HEIGHT = 46;
export const GRAPH_MAX_VISIBLE_LANES = 8;

export interface GraphEdge {
  /** 'in' merges a lane into this commit; 'out' forks to an extra parent. */
  type: 'in' | 'out';
  lane: number;
  color: number;
}

export interface GraphRow {
  commit: Commit;
  lane: number;
  color: number;
  lineAbove: boolean;
  lineBelow: boolean;
  /** Lanes passing this row untouched, drawn as straight verticals. */
  passLanes: { lane: number; color: number }[];
  edges: GraphEdge[];
}

/** Carried between pages so laying out a new page continues the old one. */
export interface GraphLayoutState {
  /** lanes[i] is the hash lane i is waiting for, or null when free. */
  lanes: (string | null)[];
  laneColors: number[];
  colorCounter: number;
  maxLanes: number;
}

export function createLayoutState(): GraphLayoutState {
  return { lanes: [], laneColors: [], colorCounter: 0, maxLanes: 1 };
}

function allocateLane(
  state: GraphLayoutState,
  hash: string,
  allocatedThisRow: Set<number>
): number {
  let index = state.lanes.indexOf(null);

  if (index === -1) {
    index = state.lanes.length;
    state.lanes.push(null);
    state.laneColors.push(0);
  }

  state.lanes[index] = hash;
  state.laneColors[index] = state.colorCounter % GRAPH_LANE_COLOR_COUNT;
  state.colorCounter += 1;
  allocatedThisRow.add(index);

  return index;
}

/**
 * Lays out `commits`, advancing `state` in place.
 *
 * Call it once per page with the same state to continue an existing graph, or
 * with a fresh state to start over.
 */
export function layoutCommits(commits: readonly Commit[], state: GraphLayoutState): GraphRow[] {
  const rows: GraphRow[] = [];

  for (const commit of commits) {
    const allocatedThisRow = new Set<number>();
    const activeAbove = state.lanes.slice();

    const matching: number[] = [];
    state.lanes.forEach((hash, index) => {
      if (hash === commit.hash) {
        matching.push(index);
      }
    });

    const lane = matching[0] ?? allocateLane(state, commit.hash, allocatedThisRow);
    const edges: GraphEdge[] = [];

    // Other lanes waiting for this same commit collapse into its dot.
    for (let k = 1; k < matching.length; k += 1) {
      const index = matching[k] as number;
      edges.push({ type: 'in', lane: index, color: state.laneColors[index] ?? 0 });
      state.lanes[index] = null;
    }

    const parents = commit.parents;
    state.lanes[lane] = parents[0] ?? null;

    // Extra parents of a merge commit fork out of the dot.
    for (let p = 1; p < parents.length; p += 1) {
      const parent = parents[p] as string;
      let index = state.lanes.indexOf(parent);
      if (index === -1 || index === lane) {
        index = allocateLane(state, parent, allocatedThisRow);
      }
      edges.push({ type: 'out', lane: index, color: state.laneColors[index] ?? 0 });
    }

    // Lanes active both above and below this row, untouched by this commit.
    const passLanes: { lane: number; color: number }[] = [];
    state.lanes.forEach((hash, index) => {
      if (hash !== null && index !== lane && !allocatedThisRow.has(index)) {
        passLanes.push({ lane: index, color: state.laneColors[index] ?? 0 });
      }
    });

    rows.push({
      commit,
      lane,
      color: state.laneColors[lane] ?? 0,
      lineAbove: activeAbove[lane] === commit.hash,
      lineBelow: state.lanes[lane] !== null,
      passLanes,
      edges
    });

    state.maxLanes = Math.max(state.maxLanes, state.lanes.length);
  }

  return rows;
}

/** Horizontal centre of a lane, clamped so deep graphs stay readable. */
export function graphLaneX(lane: number): number {
  return (
    Math.min(lane, GRAPH_MAX_VISIBLE_LANES - 1) * GRAPH_LANE_WIDTH + GRAPH_LANE_WIDTH / 2
  );
}

export function gutterWidth(maxLanes: number): number {
  return Math.min(maxLanes, GRAPH_MAX_VISIBLE_LANES) * GRAPH_LANE_WIDTH;
}
