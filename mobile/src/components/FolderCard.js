import { Image, Pressable, Text, View } from 'react-native';
import RemoteImage from './RemoteImage';
import { FONT, RADIUS, useTheme } from '../theme';
import { FolderBadge, Icon } from './ui';

const VISIBILITY = { private: ['lock', 'Private'], global: ['globe', 'Global'] };

export default function FolderCard({ f, width, onPress }) {
  const { c, tone } = useTheme();
  const t = tone(f.color), [vIcon, vLabel] = VISIBILITY[f.visibility] || ['users', 'Shared'];
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${f.title}, ${f.cardCount} cards`}
    style={({ pressed }) => ({ width, borderRadius: RADIUS + 2, borderWidth: 1, borderColor: c.border, backgroundColor: c.surface, overflow: 'hidden', opacity: pressed ? 0.88 : 1 })}>
    <View style={{ height: 92, backgroundColor: t.cover, padding: 10, justifyContent: 'space-between' }}>
      {f.thumbnail ? <RemoteImage id={f.thumbnail} resizeMode="cover" accessibilityLabel={`${f.title} cover`} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} /> : null}
      <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: c.surface }}>
        <Icon name={vIcon} size={10} color={c.muted} /><Text style={{ fontFamily: FONT.medium, fontSize: 10.5, color: c.muted }}>{vLabel}</Text>
      </View>
      <View style={{ width: 42, height: 42, borderRadius: 13, backgroundColor: c.surface, alignItems: 'center', justifyContent: 'center' }}>
        <FolderBadge icon={f.icon} color={f.color} size={30} bare />
      </View>
    </View>
    <View style={{ padding: 12, gap: 6 }}>
      <Text numberOfLines={2} style={{ fontFamily: FONT.heading, fontSize: 15, color: c.ink, minHeight: 20 }}>{f.title}</Text>
      <Text numberOfLines={2} style={{ fontFamily: FONT.body, fontSize: 12.5, lineHeight: 17, color: c.muted, minHeight: 34 }}>{f.description || 'A new collection of things worth remembering.'}</Text>
      <Text style={{ fontFamily: FONT.semibold, fontSize: 12, color: c.accent }}>{f.cardCount} card{f.cardCount === 1 ? '' : 's'}</Text>
    </View>
  </Pressable>;
}

