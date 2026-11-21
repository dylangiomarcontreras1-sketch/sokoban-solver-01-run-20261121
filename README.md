# Sokoban solver — make.fun `sokoban-solver-01-run-20261121`

[![make.fun bounty](https://make.fun/badge/sokoban-solver-01-run-20261121.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![make.fun rank](https://make.fun/badge/sokoban-solver-01-run-20261121/dylangiomarcontreras1-sketch/sokoban-solver-01-run-20261121/rank.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)
[![make.fun reward](https://make.fun/badge/sokoban-solver-01-run-20261121/dylangiomarcontreras1-sketch/sokoban-solver-01-run-20261121/reward.svg)](https://make.fun/bounty/sokoban-solver-01-run-20261121)

Entry for the make.fun bounty [Build the best Sokoban solver, 21 November 2026](https://make.fun/bounty/sokoban-solver-01-run-20261121).

## What it does

`main.ts` answers every instance of a set in one run. It reads each level at
`/input/<id>/level.txt` (XSB) and writes the player's moves in LURD to
`/output/<id>/solution.txt`, aiming for the level's push optimum `P*`.

## How it works

Every level the competition draws is a one-square hallway with one to four rooms
off it. A box pushed through a door lands in the hallway, where no push can bring
it back (the player would have to stand on the far side of the hallway, which is
wall), and the hallway holds no goal. Each room is therefore an independent
puzzle, the player only walks between rooms, and the level's optimum is the sum of
the rooms' optima.

1. **Split the level into rooms.** Compute the live squares (squares from which a
   box alone can reach a goal by pushes, pulled back from the goals over floor),
   cut the player's row at its dead squares, and take each remaining component
   that holds a box. Each component is one room.
2. **Solve each room push-optimally.** Breadth-first search over pushes. A state
   is the set of box squares plus the player's reachable region, named by its
   lowest square (only reachability matters, so the player's exact square does
   not). Pushes cost one and walking costs nothing, so the first solved state is
   push-optimal. Two sound deadlock prunings cut the search: dead squares, and a
   frozen 2x2 block of walls and boxes holding a box off its goal.
3. **Join the rooms.** Walk the player from where the last room left it to the
   next room's door, then replay that room's optimal pushes.

The result is deterministic: no clock, no randomness, and fixed tie-breaks by
square order. Two runs on the same set write the same bytes.

## Run

```sh
node main.ts
```

Node 22.18 or later runs the TypeScript directly. On Node 22.6 to 22.17 use
`node --experimental-strip-types main.ts`. The directories can be overridden
with `MAKEFUN_INPUT_DIR` and `MAKEFUN_OUTPUT_DIR`.

## License

MIT. See [LICENSE](LICENSE).
