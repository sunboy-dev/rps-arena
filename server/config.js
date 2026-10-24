// Combat Rules v1.2 — all balance numbers and skill definitions live here.
// Change values in this file to rebalance; the engine reads everything from it.

export const BALANCE = {
  maxHp: 100,
  manaStart: 2,
  manaMax: 15,

  normalDamage: 8,
  counterDamage: 8,          // Counter hits back for this, with no bonuses

  chargeMana: 1,             // Charge Mana action
  rpsDrawMana: 1,            // both players on an RPS draw
  drawAction: { open: 3, keep: 2, mana: 1 },
  drawActionCombo: { open: 4, keep: 2 },

  // Hand Bonus (card you won with)
  rockDamagePct: 25,
  scissorsMana: 1,
  scissorsHealPct: 5,        // % of current HP
  scissorsHealCapPct: 25,    // cap, % of Max HP
  paperBonus: { open: 2, keep: 1 },

  // Combo (win streak, draws do not reset it)
  comboThreshold: 3,
  comboDamagePct: 50,
  comboHealMult: 2,
  comboChargeMana: 3,

  // Angry Power (hidden from the opponent)
  angryMax: 7,
  angryPerLoss: 1,
  counterCost: 5,
  dodgeCost: { normal: 3, small: 5, medium: 7, large: null }, // null = cannot dodge

  // Cards
  deck: { rock: 20, paper: 20, scissors: 20 },
  startHand: 5,
  drawPerTurn: 1,
  handLimit: 10,

  // Pacing (online)
  turnSeconds: 20,
  defenseAutoDelayMs: [1200, 2600], // fake "thinking" delay when the defender has no option
  revealPauseMs: 1400,
  resolvePauseMs: 900,
};

// Skills are data. Each skill has a tier (decides how it can be defended),
// a cooldown, a Mana cost and a list of effects. Supported effect types:
//   { type: 'damage', base }                       -> attack, can be defended by tier
//   { type: 'heal', amount }                       -> heal self (Combo: x comboHealMult)
//   { type: 'mana', amount }                       -> gain Mana
//   { type: 'buff', stat, value, turns }           -> timed buff on self
//        stat: 'normalDamagePct' (Normal Attack only) | 'damagePct' (all damage)
// To add a new effect type, add a handler in EFFECTS in engine.js.
export const SKILLS = [
  {
    id: 'heal', name: 'Heal', tier: 'small', cooldown: 5, cost: 2,
    desc: 'ฟื้นฟู 12 HP',
    effects: [{ type: 'heal', amount: 12 }],
  },
  {
    id: 'quick', name: 'Quick Strike', tier: 'small', cooldown: 5, cost: 4,
    desc: 'Damage 10',
    effects: [{ type: 'damage', base: 10 }],
  },
  {
    id: 'heavy', name: 'Heavy Strike', tier: 'medium', cooldown: 7, cost: 5,
    desc: 'Damage 16',
    effects: [{ type: 'damage', base: 16 }],
  },
  {
    id: 'ultimate', name: 'Ultimate', tier: 'large', cooldown: 9, cost: 7,
    desc: 'Damage 26 · ป้องกันไม่ได้',
    effects: [{ type: 'damage', base: 26 }],
  },
  // Example of the kind of skill planned for later. Set enabled: true to try it.
  {
    id: 'battlecry', enabled: false, name: 'Battle Cry', tier: 'small', cooldown: 5, cost: 2,
    desc: 'Normal Attack +10% เป็นเวลา 3 Turn',
    effects: [{ type: 'buff', stat: 'normalDamagePct', value: 10, turns: 3 }],
  },
];

export const activeSkills = () => SKILLS.filter((s) => s.enabled !== false);

// Public config sent to clients (for labels and previews).
export const publicConfig = () => ({ balance: BALANCE, skills: activeSkills() });
