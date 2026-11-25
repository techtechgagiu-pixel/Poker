/** Wire protocol shared by client and server. */
import type { RoomConfig, CategoryKey } from '../engine/config';
import type { GameView } from '../engine/view';

export type SeatSlot = { kind: 'human'; pid: string } | { kind: 'bot'; level: 'easy' | 'medium' | 'hard'; name: string } | { kind: 'empty' };

export interface PublicMember {
  pid: string; name: string; role: 'player' | 'spectator'; ready: boolean; connected: boolean; isHost: boolean;
  seat: number | null; botControlled: boolean; mic: boolean; cam: boolean; registered: boolean;
}

export interface ChatMsg { id: number; pid: string; name: string; text: string; ts: number; kind: 'text' | 'reaction' | 'system' }

export interface VoteState { kind: 'pause' | 'resume' | 'save'; by: string; yes: string[]; needed: string[]; deadline: number }

export interface RoomView {
  code: string;
  status: 'LOBBY' | 'PLAYING' | 'SAVED' | 'FINISHED';
  hostPid: string;
  config: RoomConfig;
  locked: boolean;
  seats: SeatSlot[];
  members: PublicMember[];
  chat: ChatMsg[];
  vote: VoteState | null;
  pausedUntil: number | null;
  nextReady: string[];
  /** game seat -> lobby seat index (match only) */
  gameSeatPids: (string | null)[];
  matchNo: number;
  maintenance: boolean;
  mode: 'human' | 'bots' | 'training';
  scenario: string | null;
  serverTime: number;
}

export type GameAction =
  | { type: 'draw'; source: 'pile' | 'discard' }
  | { type: 'discard'; tile: number }
  | { type: 'close'; tile: number; category?: CategoryKey }
  | { type: 'pass'; tile: number }
  | { type: 'atu' };

export type ClientMsg =
  | { t: 'act'; aid: string; v: number; a: GameAction }
  | { t: 'config'; config: RoomConfig }
  | { t: 'ready'; ready: boolean }
  | { t: 'seat'; seat: number; kind: 'bot' | 'empty' | 'take' | 'leave'; level?: 'easy' | 'medium' | 'hard' }
  | { t: 'kick'; pid: string }
  | { t: 'start' }
  | { t: 'chat'; text: string }
  | { t: 'react'; emoji: string }
  | { t: 'rack'; layout: (number | null)[] }
  | { t: 'nextReady' }
  | { t: 'vote'; kind: 'pause' | 'resume' | 'save' }
  | { t: 'voteAnswer'; yes: boolean }
  | { t: 'resumeSaved' }
  | { t: 'rematch' }
  | { t: 'hint' }
  | { t: 'restartTraining'; scenario?: string | null }
  | { t: 'rtc'; to: string; data: unknown }
  | { t: 'media'; mic: boolean; cam: boolean }
  | { t: 'ping'; ts: number };

export interface Hint { kind: string; tiles: number[]; text: string }

export type ServerMsg =
  | { t: 'room'; room: RoomView; you: { pid: string; role: 'player' | 'spectator'; seat: number | null; isHost: boolean } }
  | { t: 'game'; view: GameView | null; rack?: (number | null)[] | null }
  | { t: 'err'; code: string; aid?: string }
  | { t: 'ack'; aid: string }
  | { t: 'rtc'; from: string; data: unknown }
  | { t: 'hints'; hints: Hint[] }
  | { t: 'pong'; ts: number; server: number }
  | { t: 'kicked' }
  | { t: 'replaced' };

export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const isRoomCode = (s: string) => /^[A-Z0-9]{6}$/.test(s);
