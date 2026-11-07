import { useEffect, useState } from 'react';
import { Image, Platform, View } from 'react-native';
import { API_URL, getAccessToken } from '../api';
import { useTheme } from '../theme';
import { Icon } from './ui';
import { isPending, pendingUri } from '../upload';

const LIFETIME_MS = 4 * 60_000; // the server's signed links last ten minutes; renew well before that
const cache = new Map();

/**
 * Where to load a picture from. The server answers with a short-lived signed link to the stored
 * file, and a request that carries the sign-in header would be refused by the storage service, so
 * the link is found first with the header and then loaded without it. Where the server holds the
 * picture itself (a development setup), the header goes with the image request instead.
 */
async function resolve(id) {
  const hit = cache.get(id);
  if (hit && hit.until > Date.now()) return hit.source;
  const url = `${API_URL}/api/media/${id}`, token = getAccessToken();
  const headers = token ? { Authorization: `Bearer ${token}` } : undefined;
  const controller = new AbortController();
  const response = await fetch(url, { headers, signal: controller.signal });
  if (!response.ok) { controller.abort(); throw new Error('Picture unavailable'); }
  let source;
  if (response.url && response.url !== url) { controller.abort(); source = { uri: response.url }; }
  else if (Platform.OS === 'web') source = { uri: URL.createObjectURL(await response.blob()) };
  else { controller.abort(); source = { uri: url, headers }; }
  cache.set(id, { source, until: Date.now() + LIFETIME_MS });
  return source;
}

export default function RemoteImage({ id, style, resizeMode = 'contain', accessibilityLabel }) {
  const { c } = useTheme();
  const local = isPending(id);
  const [state, setState] = useState({ source: null, failed: false });
  useEffect(() => {
    let live = true;
    setState({ source: null, failed: false });
    if (id && !local) resolve(id).then(source => live && setState({ source, failed: false }), () => live && setState({ source: null, failed: true }));
    return () => { live = false; };
  }, [id]);
  if (local) return <Image source={{ uri: pendingUri(id) }} resizeMode={resizeMode} accessibilityLabel={accessibilityLabel} style={style} />;
  if (state.source) return <Image source={state.source} resizeMode={resizeMode} accessibilityLabel={accessibilityLabel} style={style} onError={() => { cache.delete(id); setState({ source: null, failed: true }); }} />;
  return <View style={[style, { backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' }]}>
    {state.failed ? <Icon name="image" size={20} color={c.muted} /> : null}
  </View>;
}
