import { describe, expect, it } from 'vitest';

import {
  createLayoutState,
  graphLaneX,
  gutterWidth,
  layoutCommits,
  GRAPH_LANE_WIDTH,
  GRAPH_MAX_VISIBLE_LANES
} from '../src/renderer/features/history/graph-layout';
import type { Commit } from '../src/shared/git-types';

function commit(hash: string, parents: string[] = []): Commit {
  return { hash, parents, author: 'A', date: 'now', message: hash, refs: [] };
}

/** A linear history: c -> b -> a. */
const linear = [commit('c', ['b']), commit('b', ['a']), commit('a', [])];

/**
 * A merge: m has parents f and a; f branched off a.
 *   m
 *   |\
 *   | f
 *   |/
 *   a
 */
const merged = [commit('m', ['a', 'f']), commit('f', ['a']), commit('a', [])];

describe('layoutCommits', () => {
  it('keeps a linear history in one lane', () => {
    const rows = layoutCommits(linear, createLayoutState());

    expect(rows.map((row) => row.lane)).toEqual([0, 0, 0]);
    expect(rows.map((row) => row.commit.hash)).toEqual(['c', 'b', 'a']);
  });

  it('draws a line below every commit that has a parent', () => {
    const rows = layoutCommits(linear, createLayoutState());

    expect(rows.map((row) => row.lineBelow)).toEqual([true, true, false]);
    expect(rows[0]?.lineAbove).toBe(false);
    expect(rows[1]?.lineAbove).toBe(true);
  });

  it('forks a second lane for a merge commit and merges it back', () => {
    const rows = layoutCommits(merged, createLayoutState());

    const mergeRow = rows[0];
    expect(mergeRow?.edges.some((edge) => edge.type === 'out')).toBe(true);

    // The side branch occupies a second lane.
    expect(rows[1]?.lane).toBe(1);

    // The root is where both lanes converge.
    expect(rows[2]?.edges.some((edge) => edge.type === 'in')).toBe(true);
  });

  it('tracks the widest point the graph reached', () => {
    const state = createLayoutState();
    layoutCommits(merged, state);

    expect(state.maxLanes).toBeGreaterThanOrEqual(2);
  });

  it('reuses a lane freed by an earlier branch', () => {
    // Two branches that both end, then unrelated work: the freed lane index
    // should be picked up again rather than the graph growing without limit.
    const commits = [
      commit('x', ['a', 'y']),
      commit('y', ['a']),
      commit('a', []),
      commit('z', [])
    ];

    const state = createLayoutState();
    layoutCommits(commits, state);

    expect(state.maxLanes).toBeLessThanOrEqual(2);
  });

  it('produces the same rows whether laid out in one pass or paged', () => {
    // This is the property the incremental renderer depends on: appending a
    // page must give exactly what a full re-layout would have given.
    const history = [
      commit('h', ['g']),
      commit('g', ['f', 'e']),
      commit('f', ['d']),
      commit('e', ['d']),
      commit('d', ['c']),
      commit('c', ['b', 'a']),
      commit('b', ['a']),
      commit('a', [])
    ];

    const singlePass = layoutCommits(history, createLayoutState());

    const pagedState = createLayoutState();
    const paged = [
      ...layoutCommits(history.slice(0, 3), pagedState),
      ...layoutCommits(history.slice(3, 6), pagedState),
      ...layoutCommits(history.slice(6), pagedState)
    ];

    expect(paged).toEqual(singlePass);
  });

  it('handles an empty page without disturbing the state', () => {
    const state = createLayoutState();
    layoutCommits(linear, state);
    const before = JSON.stringify(state);

    expect(layoutCommits([], state)).toEqual([]);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('handles a commit whose parent is not in the loaded page', () => {
    // The last page of a truncated history: the parent is never seen.
    const rows = layoutCommits([commit('only', ['missing-parent'])], createLayoutState());

    expect(rows[0]?.lineBelow).toBe(true);
  });
});

describe('graphLaneX', () => {
  it('centres each lane in its column', () => {
    expect(graphLaneX(0)).toBe(GRAPH_LANE_WIDTH / 2);
    expect(graphLaneX(1)).toBe(GRAPH_LANE_WIDTH * 1.5);
  });

  it('clamps beyond the visible lane limit so the gutter stays bounded', () => {
    const clamped = graphLaneX(GRAPH_MAX_VISIBLE_LANES - 1);

    expect(graphLaneX(GRAPH_MAX_VISIBLE_LANES + 10)).toBe(clamped);
  });
});

describe('gutterWidth', () => {
  it('grows with the graph but stops at the visible limit', () => {
    expect(gutterWidth(1)).toBe(GRAPH_LANE_WIDTH);
    expect(gutterWidth(3)).toBe(GRAPH_LANE_WIDTH * 3);
    expect(gutterWidth(100)).toBe(GRAPH_LANE_WIDTH * GRAPH_MAX_VISIBLE_LANES);
  });
});
