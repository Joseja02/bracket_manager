import React, { useState, useMemo, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

// Lista de personajes basada en el orden oficial de Smash Ultimate
// y en los archivos disponibles en public/stock_icons.
const CHARACTERS = [
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
  'mii_fighter',
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
  'gaogaen',
  'packun_flower',
  'joker',
  'dq_hero',
  'banjo_and_kazooie',
  'terry',
  'byleth',
  'minmin',
  'steve',
  'sephiroth',
  'homura',
  'kazuya',
  'sora',
];

function slugToLabel(slug: string) {
  return slug
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function CharacterSelect({
  value,
  onChange,
  disabled = false,
}: {
  value?: string | null;
  onChange: (val: string | null) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState(query);
  const [focused, setFocused] = useState(false);

  // simple debounce implementation local to the component
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  const options = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    const filtered = CHARACTERS.filter((c) => {
      if (!q) return true;
      const slug = c.toLowerCase();
      const label = slugToLabel(c).toLowerCase();
      return slug.includes(q) || label.includes(q);
    });
    // dedupe preserving order
    return Array.from(new Set(filtered));
  }, [debounced]);

  return (
    <div className="relative">
      <Input
        placeholder="Buscar personaje..."
        value={focused ? query : value ? slugToLabel(value) : query}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
          const v = e.target.value;
          setQuery(v);
        }}
        onFocus={() => {
          // when focusing, allow editing the current selection
          if (value && !query) setQuery(slugToLabel(value));
          setFocused(true);
        }}
        onBlur={() => {
          // delay hiding to allow click selection
          setTimeout(() => setFocused(false), 150);
        }}
        disabled={disabled}
        className="bg-gradient-surface border-border/30 focus:border-primary/50"
      />

      {focused && options.length > 0 && !disabled && (
        <div className="absolute z-[100] mt-2 w-full max-h-72 overflow-auto rounded-lg border border-border/30 bg-[hsl(var(--card))] py-1 shadow-xl shadow-black/40 scrollbar-gaming">
          {options.map((slug) => (
            <button
              key={slug}
              type="button"
              aria-label={slugToLabel(slug)}
              className={cn(
                'flex items-center gap-3 w-full px-3 py-2.5 text-left transition-colors',
                'hover:bg-primary/10',
                value === slug && 'bg-primary/15 border-l-2 border-primary'
              )}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                onChange(slug);
                setQuery('');
                setFocused(false);
              }}
            >
              <img src={`${import.meta.env.BASE_URL}stock_icons/${slug}.png`} alt={slug} className="h-8 w-8 object-contain" />
              <span className="flex-1 text-sm text-current truncate">{slugToLabel(slug)}</span>
              {value === slug && <Check className="h-4 w-4 text-primary" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default CharacterSelect;
