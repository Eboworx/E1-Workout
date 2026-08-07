/**
 * Ab warm-up bank — 8 short circuits done at the top of every workout.
 * Rotation: session count % 8 picks the default; user can swap.
 */
export const AB_BANK = [
  {
    name: 'Crunch Basics',
    moves: [
      { name: 'Crunches', dose: '×20' },
      { name: 'Dead bug', dose: '×10/side' },
      { name: 'Plank', dose: '45s' },
    ],
  },
  {
    name: 'Plank Series',
    moves: [
      { name: 'Plank', dose: '60s' },
      { name: 'Side plank', dose: '30s/side' },
      { name: 'Shoulder taps', dose: '×20' },
    ],
  },
  {
    name: 'Lower Focus',
    moves: [
      { name: 'Leg raises', dose: '×12' },
      { name: 'Reverse crunches', dose: '×15' },
      { name: 'Flutter kicks', dose: '×30' },
    ],
  },
  {
    name: 'Rotation',
    moves: [
      { name: 'Russian twists', dose: '×30' },
      { name: 'Bicycle crunches', dose: '×20' },
      { name: 'Windshield wipers', dose: '×10' },
    ],
  },
  {
    name: 'Hollow Work',
    moves: [
      { name: 'Hollow hold', dose: '30s' },
      { name: 'Hollow rocks', dose: '×12' },
      { name: 'V-ups', dose: '×10' },
    ],
  },
  {
    name: 'Dynamic',
    moves: [
      { name: 'Mountain climbers', dose: '×30' },
      { name: 'Plank to pike', dose: '×10' },
      { name: 'Bear hold', dose: '30s' },
    ],
  },
  {
    name: 'Weighted',
    moves: [
      { name: 'Weighted crunches', dose: '×15' },
      { name: 'Weighted sit-ups', dose: '×12' },
      { name: 'Suitcase carry', dose: '40 steps' },
    ],
  },
  {
    name: 'Quick Burner',
    moves: [
      { name: 'Sit-ups', dose: '×25' },
      { name: 'Toe touches', dose: '×15' },
      { name: 'Bicycle crunches', dose: '×30' },
    ],
  },
]
