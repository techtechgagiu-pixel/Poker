import { create } from 'zustand';
import type { GameView } from '../engine/view';
import type { RoomView, Hint } from '../shared/protocol';

export type ThemeKey = 'walnut' | 'mahogany' | 'black' | 'oak' | 'midnight';
export interface Settings {
  lang: 'ro' | 'en'; theme: ThemeKey; quality: 'auto' | 'performance' | 'balanced' | 'ultra'; fps: 'auto' | '60' | '120';
  reducedMotion: boolean; highContrast: boolean; skipAnim: boolean;
  rackRows: 2 | 3; tileSize: 's' | 'm' | 'l'; tileSpacing: number; snapping: boolean;
  master: number; music: number; sfx: number; voice: number; notif: number; mute: boolean; ambient: 'fire' | 'lounge' | 'room';
  diagnostics: boolean; pushToTalk: boolean; videoQuality: 'low' | 'balanced' | 'high'; mirror: boolean;
  micId: string; camId: string; speakerId: string; nickname: string; confirmJoker: boolean;
}
export const defaultSettings: Settings = {
  lang: 'ro', theme: 'walnut', quality: 'auto', fps: 'auto', reducedMotion: false, highContrast: false, skipAnim: false,
  rackRows: 2, tileSize: 'm', tileSpacing: 4, snapping: true,
  master: 0.8, music: 0, sfx: 0.8, voice: 1, notif: 0.7, mute: false, ambient: 'fire',
  diagnostics: false, pushToTalk: false, videoQuality: 'balanced', mirror: true, micId: '', camId: '', speakerId: '', nickname: '', confirmJoker: true,
};
function loadSettings(): Settings {
  try {
    const s = { ...defaultSettings, ...JSON.parse(localStorage.getItem('remi.settings') ?? '{}') };
    if (!localStorage.getItem('remi.settings') && navigator.language && !navigator.language.startsWith('ro')) s.lang = defaultSettings.lang; // Romanian is the default
    return s;
  } catch { return { ...defaultSettings }; }
}

export interface Toast { id: number; text: string; kind: 'info' | 'error' | 'achievement' }
export interface NetStats { status: 'idle' | 'connecting' | 'open' | 'closed'; latency: number | null; reconnects: number; lastAck: number | null; serverOffset: number }

interface State {
  settings: Settings;
  setSettings: (p: Partial<Settings>) => void;
  route: string; navigate: (to: string, replace?: boolean) => void;
  // authoritative (server) state
  room: RoomView | null; you: { pid: string; role: 'player' | 'spectator'; seat: number | null; isHost: boolean } | null;
  game: GameView | null;
  // local visual state
  selected: number[]; historySeat: number | null; hints: Hint[]; pendingAid: string | null; sortOpen: boolean; settingsOpen: boolean; chatOpen: boolean; replayKey: number;
  net: NetStats;
  toasts: Toast[]; toast: (text: string, kind?: Toast['kind']) => void;
  profile: { id: string; username: string; nickname: string; avatar: string } | null;
  set: (p: Partial<State>) => void;
}

let toastId = 0;
export const useStore = create<State>((set, get) => ({
  settings: loadSettings(),
  setSettings: (p) => { const s = { ...get().settings, ...p }; try { localStorage.setItem('remi.settings', JSON.stringify(s)); } catch { /* ignore */ } set({ settings: s }); },
  route: location.pathname,
  navigate: (to, replace) => { if (replace) history.replaceState(null, '', to); else history.pushState(null, '', to); set({ route: to }); },
  room: null, you: null, game: null,
  selected: [], historySeat: null, hints: [], pendingAid: null, sortOpen: false, settingsOpen: false, chatOpen: false, replayKey: 0,
  net: { status: 'idle', latency: null, reconnects: 0, lastAck: null, serverOffset: 0 },
  toasts: [],
  toast: (text, kind = 'info') => {
    const id = ++toastId;
    set({ toasts: [...get().toasts.slice(-3), { id, text, kind }] });
    setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== id) }), kind === 'achievement' ? 5000 : 3200);
  },
  profile: null,
  set: (p) => set(p),
}));
window.addEventListener('popstate', () => useStore.setState({ route: location.pathname }));

/** Media state lives in its own store so speaking indicators never re-render the table. */
export interface MediaPeer { pid: string; stream: MediaStream | null; speaking: boolean; volume: number; muted: boolean; hiddenVideo: boolean; state: string }
interface MediaState {
  micOn: boolean; camOn: boolean; local: MediaStream | null; peers: Record<string, MediaPeer>; localSpeaking: boolean; error: string | null; allVideoHidden: boolean; expanded: string | null;
  set: (p: Partial<MediaState>) => void;
}
export const useMedia = create<MediaState>((set) => ({ micOn: false, camOn: false, local: null, peers: {}, localSpeaking: false, error: null, allVideoHidden: false, expanded: null, set: (p) => set(p) }));
(window as any).__remiMedia = useMedia;
