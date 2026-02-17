import { useState, useMemo, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Check, Search } from 'lucide-react';
import { CHARACTERS, slugToLabel } from '@/lib/characters';

const assetBase = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

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
  const gridRef = useRef<HTMLDivElement>(null);

  const options = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CHARACTERS.filter((c) => {
      if (!q) return true;
      return c.toLowerCase().includes(q) || slugToLabel(c).toLowerCase().includes(q);
    });
  }, [query]);

  // Scroll selected character into view on mount
  useEffect(() => {
    if (value && gridRef.current) {
      const el = gridRef.current.querySelector(`[data-char="${value}"]`);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Buscar personaje..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          disabled={disabled}
          className="pl-9 bg-gradient-surface border-border/30 focus:border-primary/50"
        />
      </div>

      <div
        ref={gridRef}
        className="max-h-60 overflow-y-auto scrollbar-gaming rounded-lg border border-border/30 bg-card/50 p-2"
      >
        <div className="grid grid-cols-4 sm:grid-cols-5 gap-1">
          {options.map((slug) => {
            const isSelected = value === slug;
            return (
              <button
                key={slug}
                type="button"
                data-char={slug}
                onClick={() => !disabled && onChange(slug)}
                disabled={disabled}
                className={cn(
                  'relative flex flex-col items-center gap-0.5 p-1.5 rounded-lg transition-all',
                  'hover:bg-primary/10 active:scale-95',
                  isSelected && 'bg-primary/15 ring-1 ring-primary shadow-sm shadow-primary/20'
                )}
              >
                <img
                  src={`${assetBase}stock_icons/${slug}.png`}
                  alt={slugToLabel(slug)}
                  className="w-8 h-8 object-contain"
                  loading="lazy"
                />
                <span className="text-[9px] text-muted-foreground leading-tight text-center line-clamp-1 w-full">
                  {slugToLabel(slug)}
                </span>
                {isSelected && (
                  <div className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-primary-foreground" />
                  </div>
                )}
              </button>
            );
          })}
          {options.length === 0 && (
            <div className="col-span-full py-4 text-center text-sm text-muted-foreground">
              No se encontraron personajes
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CharacterSelect;
