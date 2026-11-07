import RemoteImage from './RemoteImage';
import { useState } from 'react';
import { Image, Platform, View } from 'react-native';
import { pickImage, uploadImage } from '../upload';
import { useTheme } from '../theme';
import { Button, Txt } from './ui';

/** One picture for one side of a card: choose, see it, remove it. It uploads as soon as it is chosen. */
export default function ImageField({ folderId, value, onChange }) {
  const { c } = useTheme();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');

  async function add(source) {
    if (busy) return;
    setError('');
    try {
      const asset = await pickImage(source);
      if (!asset) return;
      setBusy(true);
      onChange(await uploadImage(folderId, asset));
    } catch (e) { setError(e.message || 'The picture could not be added.'); }
    finally { setBusy(false); }
  }

  return <View style={{ gap: 10 }}>
    {value ? <RemoteImage id={value} resizeMode="contain" accessibilityLabel="Picture on this side"
      style={{ width: '100%', height: 170, borderRadius: 12, backgroundColor: c.surface2 }} /> : null}
    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
      <Button small variant="soft" icon="image" title={value ? 'Replace picture' : 'Add picture'} loading={busy} onPress={() => add('library')} />
      {Platform.OS !== 'web' && !value ? <Button small variant="soft" icon="camera" title="Camera" disabled={busy} onPress={() => add('camera')} /> : null}
      {value ? <Button small variant="danger" icon="trash-2" title="Remove" disabled={busy} onPress={() => onChange(null)} /> : null}
    </View>
    {error ? <Txt variant="small" style={{ color: c.danger }}>{error}</Txt> : null}
  </View>;
}
