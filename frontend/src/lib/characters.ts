// Lista de personajes basada en el orden oficial de Smash Ultimate
// y en los archivos disponibles en public/stock_icons.
export const CHARACTERS = [
  'mario',
  'donkey_kong',
  'link',
  'samus',
  'dark_samus',
  'yoshi',
  'kirby',
  'fox',
  'pikachu',
  'luigi',
  'ness',
  'captain_falcon',
  'jigglypuff',
  'peach',
  'daisy',
  'bowser',
  'ice_climbers',
  'sheik',
  'zelda',
  'dr_mario',
  'pichu',
  'falco',
  'marth',
  'lucina',
  'young_link',
  'ganondorf',
  'mewtwo',
  'roy',
  'chrom',
  'mr_game_and_watch',
  'meta_knight',
  'pit',
  'dark_pit',
  'zero_suit_samus',
  'wario',
  'snake',
  'ike',
  'pokemon_trainer',
  'diddy_kong',
  'lucas',
  'sonic',
  'king_dedede',
  'olimar',
  'lucario',
  'rob',
  'toon_link',
  'wolf',
  'villager',
  'mega_man',
  'wii_fit_trainer',
  'rosalina_and_luma',
  'little_mac',
  'greninja',
  'mii_brawler',
  'palutena',
  'pac_man',
  'robin',
  'shulk',
  'bowser_jr',
  'duck_hunt',
  'ryu',
  'ken',
  'cloud',
  'corrin',
  'bayonetta',
  'inkling',
  'ridley',
  'simon',
  'richter',
  'king_k_rool',
  'isabelle',
  'incineroar',
  'piranha_plant',
  'joker',
  'hero',
  'banjo_and_kazooie',
  'terry',
  'byleth',
  'minmin',
  'steve',
  'sephiroth',
  'pyra_and_mythra',
  'kazuya',
  'sora',
] as const;

export type Character = typeof CHARACTERS[number];

const CHARACTER_LABEL_OVERRIDES: Record<string, string> = {
  pyra_and_mythra: 'Pyra & Mythra',
};

/** Slugs legacy en reportes antiguos → slug actual (iconos/nombres). */
const LEGACY_CHARACTER_SLUGS: Record<string, string> = {
  gaogaen: 'incineroar',
  mii_fighter: 'mii_brawler',
  packun_flower: 'piranha_plant',
  dq_hero: 'hero',
  homura: 'pyra_and_mythra',
};

export function resolveCharacterSlug(slug: string): string {
  return LEGACY_CHARACTER_SLUGS[slug] ?? slug;
}

export function slugToLabel(slug: string) {
  const resolved = resolveCharacterSlug(slug);
  if (CHARACTER_LABEL_OVERRIDES[resolved]) {
    return CHARACTER_LABEL_OVERRIDES[resolved];
  }
  return resolved
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
