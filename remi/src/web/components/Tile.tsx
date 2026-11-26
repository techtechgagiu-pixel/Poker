import { memo } from 'react';
import { tileFace, JokerInfo, isRealJoker } from '../../engine/tiles';

export const COLOR_CLASS = ['c-red', 'c-blue', 'c-yellow', 'c-black'];
/** Shape symbols so colour is never the only cue (colour-blind friendly). */
export const COLOR_SYMBOL = ['●', '■', '▲', '◆'];

interface Props { id: number; joker?: JokerInfo | null; w: number; h: number; faceDown?: boolean; selected?: boolean; hint?: boolean; className?: string; style?: React.CSSProperties; title?: string }

export const Tile = memo(function Tile({ id, joker, w, h, faceDown, selected, hint, className = '', style, title }: Props) {
  if (faceDown) return <div className={`tile back ${className}`} style={{ width: w, height: h, ...style }} />;
  const f = tileFace(id);
  const real = joker ? isRealJoker(id, joker) : false;
  if (f.falseJoker) {
    return (
      <div className={`tile false-joker ${selected ? 'sel' : ''} ${hint ? 'hint' : ''} ${className}`} style={{ width: w, height: h, ...style }} title={title ?? 'Joker fals'} data-tile={id}>
        <span className="fj-crest" style={{ fontSize: h * 0.56 }}>★</span>
      </div>
    );
  }
  return (
    <div className={`tile ${COLOR_CLASS[f.color]} ${selected ? 'sel' : ''} ${real ? 'real-joker' : ''} ${hint ? 'hint' : ''} ${className}`} style={{ width: w, height: h, ...style }} data-tile={id} title={title}>
      <span className="num" style={{ fontSize: h * 0.46 }}>{f.num}</span>
      <span className="sym" style={{ fontSize: h * 0.17 }}>{COLOR_SYMBOL[f.color]}</span>
      <span className="dot" style={{ width: h * 0.24, height: h * 0.24, fontSize: h * 0.1 }}>{COLOR_SYMBOL[f.color]}</span>
      {real && <span className="jbadge" style={{ fontSize: h * 0.15 }}>J</span>}
    </div>
  );
});
