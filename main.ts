// Push-optimal Sokoban solver for make.fun's sokoban-solver-01.
//
// Every level the competition draws is a hallway with one to four rooms off it. A box pushed through a
// door lands in the hallway, where no push can bring it back (the player would have to stand on the far
// side of the one-square hallway, which is wall), and the hallway itself holds no goal. So each room is
// an independent puzzle, the player only walks between them, and the level's push optimum P* is the sum
// of the rooms' push optima. Solving each room optimally therefore solves the level in exactly P*.
//
// A room is solved by a breadth-first search over pushes. A state is the set of box squares plus the
// player's reachable region (named by its lowest square, since only reachability matters). States are
// expanded in order of pushes made, so the first solved state is push-optimal. Two sound deadlock
// prunings cut the search: a dead square (one from which no box, alone, can ever be pushed to a goal)
// and a frozen 2x2 block of walls and boxes holding a box off its goal. Neither removes a solvable
// state, so the optimum stands.
//
// Pure and deterministic: no clock, no randomness, fixed tie-breaks by square order.

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const INPUT_DIR = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUTPUT_DIR = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The most states one room's search may keep: work, never the clock. */
const ROOM_STATES = 1_500_000;
/** The most states a whole level's search may keep when it does not split into rooms. */
const WHOLE_STATES = 2_500_000;

/** The four directions: [dx, dy, the move's letter, the push's letter]. */
const DIRS: ReadonlyArray<readonly [number, number, string, string]> = [
  [0, -1, 'u', 'U'],
  [0, 1, 'd', 'D'],
  [-1, 0, 'l', 'L'],
  [1, 0, 'r', 'R'],
];

type Level = {
  w: number;
  h: number;
  wall: Uint8Array;
  goals: number[];
  boxes: number[];
  player: number;
};

type Room = {
  boxes: number[];
  goals: number[];
};

/** A level in XSB: `#` wall, `.` goal, `$` box, `*` box on a goal, `@` player, `+` player on a goal. */
export function parseLevel(text: string): Level {
  const rows = text.split('\n').filter((r) => r.length > 0);
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const wall = new Uint8Array(w * h).fill(1);
  const goals: number[] = [];
  const boxes: number[] = [];
  let player = -1;
  for (let y = 0; y < h; y++) {
    const row = rows[y]!;
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      const i = y * w + x;
      if (ch === '#') continue;
      wall[i] = 0;
      if (ch === '.' || ch === '*' || ch === '+') goals.push(i);
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) wall[y * w + x] = 1;
    }
  }
  return { w, h, wall, goals: goals.sort((a, b) => a - b), boxes: boxes.sort((a, b) => a - b), player };
}

/** The squares from which a box alone can be pushed onto some goal: pulled back from the goals over floor. */
function liveSquares(level: Level): Uint8Array {
  const { w, wall, goals } = level;
  const live = new Uint8Array(wall.length);
  const queue: number[] = [];
  for (const g of goals) {
    live[g] = 1;
    queue.push(g);
  }
  for (let qi = 0; qi < queue.length; qi++) {
    const x = queue[qi]!;
    for (const [dx, dy] of DIRS) {
      const d = dy * w + dx;
      const y = x - d;
      if (!wall[y] && !wall[y - d] && !live[y]) {
        live[y] = 1;
        queue.push(y);
      }
    }
  }
  return live;
}

/**
 * The level's rooms: cut the player's row at its dead squares (the hallway, where no box reaches a goal)
 * and take each remaining part that holds a box. Null when the level is not a set of rooms.
 */
function roomsOf(level: Level): Room[] | null {
  const { w, wall, goals, boxes, player } = level;
  const live = liveSquares(level);
  const row = Math.floor(player / w);
  const cut = new Uint8Array(wall.length);
  for (let i = row * w; i < (row + 1) * w; i++) if (!wall[i] && !live[i]) cut[i] = 1;
  if (boxes.some((b) => cut[b])) return null;
  const part = new Int32Array(wall.length).fill(-1);
  const rooms: Room[] = [];
  for (let s = 0; s < wall.length; s++) {
    if (wall[s] || cut[s] || part[s] >= 0) continue;
    const squares = [s];
    part[s] = rooms.length;
    for (let i = 0; i < squares.length; i++) {
      for (const [dx, dy] of DIRS) {
        const q = squares[i]! + dy * w + dx;
        if (!wall[q] && !cut[q] && part[q] < 0) {
          part[q] = rooms.length;
          squares.push(q);
        }
      }
    }
    rooms.push({ boxes: [], goals: [] });
  }
  for (const b of boxes) {
    const r = rooms[part[b]!];
    if (r === undefined) return null;
    r.boxes.push(b);
  }
  for (const g of goals) {
    const p = part[g]!;
    if (p >= 0) rooms[p]!.goals.push(g);
  }
  if (goals.some((g) => part[g]! < 0)) return null;
  if (rooms.some((r) => r.boxes.length !== r.goals.length)) return null;
  return rooms.filter((r) => r.boxes.length > 0);
}

/** The shortest walk from `from` to `to` around walls and boxes, in lower LURD letters. */
function walkTo(level: Level, occupied: Uint8Array, from: number, to: number): string {
  if (from === to) return '';
  const { w, wall } = level;
  const prev = new Int32Array(wall.length).fill(-1);
  const how: string[] = new Array(wall.length).fill('');
  const queue: number[] = [from];
  prev[from] = from;
  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi]!;
    if (p === to) break;
    for (const [dx, dy, letter] of DIRS) {
      const q = p + dy * w + dx;
      if (wall[q] || occupied[q] || prev[q] !== -1) continue;
      prev[q] = p;
      how[q] = letter;
      queue.push(q);
    }
  }
  if (prev[to] === -1) throw new Error('walkTo: unreachable push square');
  let out = '';
  for (let p = to; p !== from; p = prev[p]!) out = how[p]! + out;
  return out;
}

/** The square the player stands on after `moves` (case ignored) from `from`. */
function endOf(w: number, from: number, moves: string): number {
  let p = from;
  for (let i = 0; i < moves.length; i++) {
    const ch = moves[i]!.toLowerCase();
    p += ch === 'u' ? -w : ch === 'd' ? w : ch === 'l' ? -1 : 1;
  }
  return p;
}

/**
 * The push-optimal solution of `level`, searching at most `maxStates` states: {pushes, moves} (moves in
 * LURD, a lower letter a step and an upper one a push), or null when the search gives up or no solution exists.
 */
function solvePushOptimal(level: Level, maxStates: number): { pushes: number; moves: string } | null {
  const { w, wall, goals, player } = level;
  const size = wall.length;
  // A numeric state key stays exact while size ** (boxes + 1) is a safe integer.
  if (size ** (level.boxes.length + 1) > Number.MAX_SAFE_INTEGER) return null;
  const goal = new Uint8Array(size);
  for (const g of goals) goal[g] = 1;
  const live = liveSquares(level);
  for (const b of level.boxes) if (!live[b]) return null;

  const occupied = new Uint8Array(size);
  const seen = new Int32Array(size);
  const mark = new Int32Array(size);
  const stack = new Int32Array(size);
  let stamp = 0;

  const reach = (from: number, marks: Int32Array): number => {
    const tag = ++stamp;
    let low = from;
    let n = 0;
    stack[n++] = from;
    marks[from] = tag;
    while (n > 0) {
      const p = stack[--n]!;
      if (p < low) low = p;
      const q0 = p - w;
      if (wall[q0] === 0 && occupied[q0] === 0 && marks[q0] !== tag) {
        marks[q0] = tag;
        stack[n++] = q0;
      }
      const q1 = p + w;
      if (wall[q1] === 0 && occupied[q1] === 0 && marks[q1] !== tag) {
        marks[q1] = tag;
        stack[n++] = q1;
      }
      const q2 = p - 1;
      if (wall[q2] === 0 && occupied[q2] === 0 && marks[q2] !== tag) {
        marks[q2] = tag;
        stack[n++] = q2;
      }
      const q3 = p + 1;
      if (wall[q3] === 0 && occupied[q3] === 0 && marks[q3] !== tag) {
        marks[q3] = tag;
        stack[n++] = q3;
      }
    }
    return low;
  };

  const keyOf = (boxes: number[], low: number): number => {
    let k = low;
    for (let i = 0; i < boxes.length; i++) k = k * size + boxes[i]!;
    return k;
  };

  const blockFrozen = (a: number): boolean => {
    const b = a + 1;
    const c = a + w;
    const d = c + 1;
    if (!(wall[a] || occupied[a])) return false;
    if (!(wall[b] || occupied[b])) return false;
    if (!(wall[c] || occupied[c])) return false;
    if (!(wall[d] || occupied[d])) return false;
    if (occupied[a] && !goal[a]) return true;
    if (occupied[b] && !goal[b]) return true;
    if (occupied[c] && !goal[c]) return true;
    if (occupied[d] && !goal[d]) return true;
    return false;
  };

  const frozen = (t: number): boolean =>
    blockFrozen(t) || blockFrozen(t - 1) || blockFrozen(t - w) || blockFrozen(t - w - 1);

  const start = level.boxes.slice();
  const solved = (boxes: number[]): boolean => {
    for (let i = 0; i < boxes.length; i++) if (!goal[boxes[i]!]) return false;
    return true;
  };

  const stateBoxes: number[][] = [start];
  const statePlayer: number[] = [player];
  const parent: number[] = [-1];
  const pushFrom: number[] = [-1];
  const pushTo: number[] = [-1];
  const index = new Map<number, number>();

  for (const b of start) occupied[b] = 1;
  index.set(keyOf(start, reach(player, seen)), 0);
  for (const b of start) occupied[b] = 0;

  let found = solved(start) ? 0 : -1;
  for (let head = 0; found < 0 && head < stateBoxes.length; head++) {
    const boxes = stateBoxes[head]!;
    for (const b of boxes) occupied[b] = 1;
    reach(statePlayer[head]!, seen);
    const here = stamp;
    for (let bi = 0; bi < boxes.length && found < 0; bi++) {
      const b = boxes[bi]!;
      for (const [dx, dy] of DIRS) {
        const d = dy * w + dx;
        const t = b + d;
        if (seen[b - d] !== here || wall[t] || occupied[t] || !live[t]) continue;
        occupied[b] = 0;
        occupied[t] = 1;
        let next: number[] | null = null;
        let key = -1;
        if (!frozen(t)) {
          next = boxes.slice();
          next[bi] = t;
          next.sort((x, y) => x - y);
          key = keyOf(next, reach(b, mark));
        }
        occupied[t] = 0;
        occupied[b] = 1;
        if (next === null || index.has(key)) continue;
        if (stateBoxes.length >= maxStates) {
          for (const x of boxes) occupied[x] = 0;
          return null;
        }
        index.set(key, stateBoxes.length);
        stateBoxes.push(next);
        statePlayer.push(b);
        parent.push(head);
        pushFrom.push(b);
        pushTo.push(t);
        if (solved(next)) {
          found = stateBoxes.length - 1;
          break;
        }
      }
    }
    for (const x of boxes) occupied[x] = 0;
  }
  if (found < 0) return null;

  const path: number[] = [];
  for (let s = found; s > 0; s = parent[s]!) path.push(s);
  path.reverse();

  let moves = '';
  let playerAt = player;
  const boxes = start.slice();
  for (const b of boxes) occupied[b] = 1;
  for (const s of path) {
    const from = pushFrom[s]!;
    const to = pushTo[s]!;
    const d = to - from;
    let letter = '';
    for (const [dx, dy, , push] of DIRS) {
      if (dy * w + dx === d) {
        letter = push;
        break;
      }
    }
    moves += walkTo(level, occupied, playerAt, from - d);
    moves += letter;
    occupied[from] = 0;
    occupied[to] = 1;
    playerAt = from;
  }
  return { pushes: path.length, moves };
}

/** The level solved room by room, or as one level when it does not split into rooms. */
export function solveLevel(level: Level): string {
  const rooms = roomsOf(level);
  if (rooms === null) {
    const whole = solvePushOptimal(level, WHOLE_STATES);
    return whole === null ? '' : whole.moves;
  }
  let player = level.player;
  let moves = '';
  for (let ri = 0; ri < rooms.length; ri++) {
    const room = rooms[ri]!;
    const wall = level.wall.slice();
    for (let rj = 0; rj < rooms.length; rj++) {
      if (rj === ri) continue;
      const other = rooms[rj]!;
      const standing = rj < ri ? other.goals : other.boxes;
      for (const b of standing) wall[b] = 1;
    }
    const sub: Level = {
      w: level.w,
      h: level.h,
      wall,
      goals: room.goals.slice().sort((a, b) => a - b),
      boxes: room.boxes.slice().sort((a, b) => a - b),
      player,
    };
    const solved = solvePushOptimal(sub, ROOM_STATES);
    if (solved === null) return '';
    moves += solved.moves;
    player = endOf(level.w, player, solved.moves);
  }
  return moves;
}

function main(): void {
  const ids = readdirSync(INPUT_DIR)
    .filter((id) => {
      try {
        return statSync(join(INPUT_DIR, id)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();

  for (const id of ids) {
    let moves = '';
    try {
      moves = solveLevel(parseLevel(readFileSync(join(INPUT_DIR, id, 'level.txt'), 'utf8')));
    } catch {
      moves = '';
    }
    mkdirSync(join(OUTPUT_DIR, id), { recursive: true });
    writeFileSync(join(OUTPUT_DIR, id, 'solution.txt'), `${moves}\n`);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
