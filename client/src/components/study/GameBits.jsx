import { Sunrise, Shapes, DoorOpen, Scale, Keyboard, Mic, Heart, Sparkles, Zap, Mountain, Bird, Moon, Sun, Coffee, Flame, MoonStar, Map, TreePine, Star, Lock } from 'lucide-react';
import { BADGES } from '../../../../shared/game.js';

const ICONS = { sunrise: Sunrise, shapes: Shapes, door: DoorOpen, scale: Scale, keyboard: Keyboard, mic: Mic, heart: Heart, sparkles: Sparkles, zap: Zap, mountain: Mountain, bird: Bird, moon: Moon, sun: Sun, coffee: Coffee, flame: Flame, moonstar: MoonStar, map: Map, tree: TreePine, star: Star };
export const badgeById = Object.fromEntries(BADGES.map(b => [b.id, b]));

/** A hexagonal medal in the badge's rarity colour, or a grey one with a lock while it is still to earn. */
export function BadgeMedal({ id, earned = true, size = 52 }) {
  const badge = badgeById[id]; if (!badge) return null;
  const Icon = ICONS[badge.icon] || Star;
  return <span className={`badge-medal rarity-${badge.rarity} ${earned ? 'is-earned' : 'is-locked'}`} style={{ '--medal': `${size}px` }} aria-hidden="true">
    <span className="badge-medal-face"><Icon size={Math.round(size * 0.42)} strokeWidth={2.2}/></span>
    {!earned && <span className="badge-medal-lock"><Lock size={Math.max(9, Math.round(size * 0.2))}/></span>}
  </span>;
}

/** Level, title and how far into the next level, as a slim bar. */
export function LevelBar({ level, compact = false }) {
  if (!level) return null;
  const share = level.needed ? Math.min(1, level.into / level.needed) : 0;
  return <div className={`level-bar ${compact ? 'is-compact' : ''}`}>
    <span className="level-chip" aria-label={`Level ${level.level}`}>{level.level}</span>
    <div className="level-bar-body">
      <div className="level-bar-top"><strong>{level.title}</strong><span>{level.into.toLocaleString()} / {level.needed.toLocaleString()} XP</span></div>
      <div className="level-bar-track" role="progressbar" aria-valuemin={0} aria-valuemax={level.needed} aria-valuenow={level.into} aria-label="Progress to the next level"><span style={{ width: `${share * 100}%` }}/></div>
    </div>
  </div>;
}
