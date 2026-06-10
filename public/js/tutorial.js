// T0 tutorial probes live in code, not in the deck — the deck file is
// user-swappable and the zero-stakes warm-up must survive any swap.
export const TUTORIAL = [
  { id: 't0-01', tier: 0, modes: ['table', 'dyad'], answerType: 'binary', category: 'live', text: 'Did {name} drink coffee today?' },
  { id: 't0-02', tier: 0, modes: ['table', 'dyad'], answerType: 'binary', category: 'live', text: 'Is {name} wearing socks right now?' },
  { id: 't0-03', tier: 0, modes: ['table', 'dyad'], answerType: 'binary', category: 'live', text: 'Has {name} eaten a vegetable today?' },
];
