export type ID = string | number;

export interface User {
  id: ID;
  gamerTag: string;
  role: 'competitor' | 'admin';
  startgg_user_id?: string;
}

export interface EventSummary {
  id: ID;
  name: string;
  game: 'smash_ultimate';
  bestOf?: number;
  startAt?: string | number;
  status?: 'upcoming' | 'active' | 'completed';
  tournamentName?: string;
  tournamentSlug?: string;
  isAdmin?: boolean;
  userEntrantId?: ID;
}

export interface SetParticipant {
  userId?: ID;
  entrantId: ID;
  name: string;
}

export interface SetSummary {
  id: ID;
  eventId: ID;
  eventName: string;
  round: string;
  bestOf: number;
  p1: SetParticipant;
  p2: SetParticipant;
  status: 'not_started' | 'in_progress' | 'reported' | 'approved' | 'rejected' | 'completed';
  isAdmin?: boolean;
  reportStatus?: 'pending' | 'approved' | 'rejected';
}

export interface ExistingReport {
  id: ID;
  status: 'pending' | 'approved' | 'rejected';
  scoreP1: number;
  scoreP2: number;
  notes?: string | null;
  rejectionReason?: string | null;
  submittedBy?: string;
  createdAt?: string;
  games: GameRecord[];
}

export type StageName =
  | 'Battlefield'
  | 'Small Battlefield'
  | 'Final Destination'
  | 'Smashville'
  | 'Pokemon Stadium 2'
  | 'Town and City'
  | "Yoshi's Story"
  | 'Hollow Bastion'
  | 'Kalos Pokemon League';

export const STAGES: StageName[] = [
  'Battlefield',
  'Small Battlefield',
  'Final Destination',
  'Smashville',
  'Pokemon Stadium 2',
  'Town and City',
  "Yoshi's Story",
  'Hollow Bastion',
  'Kalos Pokemon League',
];

export interface GameRecord {
  index: number;
  stage: StageName | null;
  winner: 'p1' | 'p2' | null;
  stocksP1: 0 | 1 | 2 | 3 | null;
  stocksP2: 0 | 1 | 2 | 3 | null;
  characterP1?: string | null;
  characterP2?: string | null;
}

export interface SetDetail extends SetSummary {
  stagesAvailable: StageName[];
  stagesBanned: StageName[];
  currentTurn: 'rps' | 'ban_p1' | 'ban_p2' | 'pick_p1' | 'pick_p2' | 'games' | 'completed';
  games: GameRecord[];
  rpsWinner?: 'p1' | 'p2' | null;
  existingReport?: ExistingReport;
}

export interface SetSpectateResponse {
  available: boolean;
  reason?: 'not_started' | 'finished';
  setDetail: Pick<SetDetail, 'id' | 'eventId' | 'eventName' | 'round' | 'bestOf' | 'p1' | 'p2' | 'status'>;
  draft?: {
    games?: GameRecord[];
    bansByGame?: Record<number, StageName[]>;
    rpsWinner?: 'p1' | 'p2' | null;
  } | null;
  phase?: 'waiting' | 'rps' | 'bans' | 'games' | 'submit';
  score?: { p1: number; p2: number };
  lastUpdate?: string | null;
  cachedAt?: string;
}

export interface ReportSummary {
  id: ID;
  eventId: ID;
  eventName: string;
  setId: ID;
  round: string;
  p1: SetParticipant;
  p2: SetParticipant;
  scoreP1: number;
  scoreP2: number;
  createdAt: string;
  status: 'pending' | 'approved' | 'rejected';
  submittedBy: string;
}

export interface ReportDetail extends ReportSummary {
  games: GameRecord[];
  notes?: string;
  rejectionReason?: string;
}

export function applyStocksConstraint(game: GameRecord): GameRecord {
  if (areStocksUnknown(game)) return game;
  if (game.winner === 'p1') return { ...game, stocksP1: game.stocksP1 ?? 1, stocksP2: 0 };
  if (game.winner === 'p2') return { ...game, stocksP1: 0, stocksP2: game.stocksP2 ?? 1 };
  return game;
}

/** Ambos stocks null = el usuario eligió "Desconocido" explícitamente. */
export function areStocksUnknown(game: GameRecord): boolean {
  return game.stocksP1 === null && game.stocksP2 === null;
}

export function hasValidStocks(game: GameRecord): boolean {
  if (!game.winner) return true;

  if (game.winner === 'p1') {
    if (areStocksUnknown(game)) return true;
    return (
      game.stocksP1 !== null &&
      game.stocksP1 >= 1 &&
      game.stocksP1 <= 3 &&
      game.stocksP2 === 0
    );
  }

  if (game.winner === 'p2') {
    if (areStocksUnknown(game)) return true;
    return (
      game.stocksP2 !== null &&
      game.stocksP2 >= 1 &&
      game.stocksP2 <= 3 &&
      game.stocksP1 === 0
    );
  }

  return false;
}

export function isGameComplete(game: GameRecord): boolean {
  return !!(
    game.stage &&
    game.winner &&
    game.characterP1 &&
    game.characterP2 &&
    hasValidStocks(game)
  );
}

export function getWinnerStocksSelectValue(game: GameRecord): string {
  if (!game.winner) return '';
  if (areStocksUnknown(game)) return 'unknown';

  if (game.winner === 'p1') {
    if (game.stocksP1 !== null && game.stocksP1 >= 1) return String(game.stocksP1);
    return '';
  }

  if (game.winner === 'p2') {
    if (game.stocksP2 !== null && game.stocksP2 >= 1) return String(game.stocksP2);
    return '';
  }

  return '';
}

export function calculateScore(games: GameRecord[]): { p1: number; p2: number } {
  return games.reduce(
    (acc, game) => {
      if (game.winner === 'p1') acc.p1++;
      if (game.winner === 'p2') acc.p2++;
      return acc;
    },
    { p1: 0, p2: 0 }
  );
}
