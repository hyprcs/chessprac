import type { EvalEntry, GameAnalysis, GameRecord, Profile } from './types';
import type { DrillAttempt, DrillSession } from './drill-log';

export const PROFILE_FORMAT = 'chessprac-profile';
/** 2 added the drill log (attempts and sessions). Version 1 files still read, with an empty log. */
export const PROFILE_VERSION = 2;

/** Everything about one profile, as written by "Export" and read by "Import". */
export interface ProfileFile {
  format: typeof PROFILE_FORMAT;
  version: number;
  exportedAt: number;
  profile: Profile;
  games: GameRecord[];
  analyses: GameAnalysis[];
  /** Engine evaluations by position key; shared by every game that reaches the position. */
  evals: Record<string, EvalEntry>;
  /** Spaced-repetition state per drilled position. */
  cards: unknown[];
  /** Every drill move made, and the sessions they belong to. */
  attempts: DrillAttempt[];
  sessions: DrillSession[];
}

export function parseProfileFile(text: string): ProfileFile {
  const data = JSON.parse(text);
  if (data?.format !== PROFILE_FORMAT) throw new Error('Not a chessprac profile file');
  if (data.version > PROFILE_VERSION) throw new Error(`Profile file version ${data.version} is newer than this app`);
  for (const k of ['games', 'analyses', 'cards', 'attempts', 'sessions'] as const) if (!Array.isArray(data[k])) data[k] = [];
  data.evals ??= {};
  return data as ProfileFile;
}
