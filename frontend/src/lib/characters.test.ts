import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { CHARACTERS, resolveCharacterSlug, slugToLabel } from './characters';

const iconsDir = path.resolve(process.cwd(), 'public/stock_icons');

const iconSlugs = fs
  .readdirSync(iconsDir)
  .filter((file) => file.endsWith('.png'))
  .map((file) => file.replace(/\.png$/, ''))
  .sort();

describe('CHARACTERS', () => {
  it('includes every Mii fighter variant', () => {
    // Regresión: faltaban swordfighter y gunner y no se podían elegir en el panel.
    expect(CHARACTERS).toContain('mii_brawler');
    expect(CHARACTERS).toContain('mii_swordfighter');
    expect(CHARACTERS).toContain('mii_gunner');
  });

  it('has an icon file for every character', () => {
    const missing = CHARACTERS.filter((slug) => !iconSlugs.includes(slug));

    expect(missing).toEqual([]);
  });

  it('has a character entry for every icon file', () => {
    const orphans = iconSlugs.filter((slug) => !(CHARACTERS as readonly string[]).includes(slug));

    expect(orphans).toEqual([]);
  });

  it('has no duplicate entries', () => {
    expect(new Set(CHARACTERS).size).toBe(CHARACTERS.length);
  });

  it('maps legacy mii_fighter slug to mii_brawler', () => {
    expect(resolveCharacterSlug('mii_fighter')).toBe('mii_brawler');
  });

  it('labels the Mii fighters', () => {
    expect(slugToLabel('mii_brawler')).toBe('Mii Brawler');
    expect(slugToLabel('mii_swordfighter')).toBe('Mii Swordfighter');
    expect(slugToLabel('mii_gunner')).toBe('Mii Gunner');
  });
});
