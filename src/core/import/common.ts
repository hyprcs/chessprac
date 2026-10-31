import type { GameRecord, SyncState } from '../types';
import type { HttpConfig } from './http';

export type SkipReason = 'variant' | 'custom position' | 'aborted' | 'no moves' | 'unreadable';

export interface ImportCallbacks extends HttpConfig {
  /** Only take games that finished at or after this time (ms). First import only. */
  since?: number;
  onGame: (game: GameRecord) => void | Promise<void>;
  onSkip?: (reason: SkipReason, url: string) => void;
  onProgress?: (message: string) => void;
}

export type Importer = (username: string, state: SyncState, cb: ImportCallbacks) => Promise<SyncState>;
