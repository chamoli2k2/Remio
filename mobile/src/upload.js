import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import { api } from './api';
import { BRAND } from '../../shared/brand.js';

const MAX_SIDE = 1600;

/** Ask for a picture from the library or the camera. Returns null when the person backs out or says no. */
export async function pickImage(source = 'library') {
  const permission = source === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted && permission.canAskAgain === false) throw new Error(`Allow ${source === 'camera' ? 'camera' : 'photo'} access for ${BRAND.name} in your phone's settings.`);
  if (!permission.granted && Platform.OS !== 'web') return null;
  const options = { mediaTypes: ['images'], quality: 1, allowsEditing: false };
  const result = source === 'camera' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
  return result.canceled ? null : result.assets?.[0] || null;
}

/**
 * Shrink a large photograph before it leaves the phone: a camera picture can be many megabytes,
 * and the server limits how big an upload may be. The server still checks and re-encodes whatever
 * arrives, so this only saves the person's data and time.
 */
async function prepare(asset) {
  const big = Math.max(asset.width || 0, asset.height || 0) > MAX_SIDE;
  const out = await ImageManipulator.manipulateAsync(asset.uri, big ? [{ resize: asset.width >= asset.height ? { width: MAX_SIDE } : { height: MAX_SIDE } }] : [],
    { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG });
  return out.uri;
}

/**
 * A picture waiting for a connection is written as `pending:<file>` where an image id would go.
 * The file is the already-shrunk copy, kept by the phone until the change that uses it is sent.
 */
export const PENDING = 'pending:';
export const isPending = value => typeof value === 'string' && value.startsWith(PENDING);
export const pendingUri = value => value.slice(PENDING.length);

/** Shrink a picked picture and keep the copy on the phone. Needs no connection. */
export const stage = asset => prepare(asset);

/** Send an already-shrunk file to an upload endpoint (a folder's or a notebook's) and return its media id. */
export async function uploadStaged(endpoint, uri) {
  const form = new FormData();
  if (Platform.OS === 'web') form.append('image', await (await fetch(uri)).blob(), 'card.jpg');
  else form.append('image', { uri, name: 'card.jpg', type: 'image/jpeg' });
  const { id } = await api(endpoint, { method: 'POST', form, timeout: 60_000 });
  return id;
}

/** Upload a picked picture to a folder and return its media id. */
export async function uploadImage(folderId, asset) {
  return uploadStaged(`/folders/${folderId}/images`, await prepare(asset));
}

/**
 * Add a picture to something being written. Online it is uploaded right away and the id comes
 * back; with no connection it is kept on the phone and a `pending:` marker comes back instead, to
 * be uploaded when the change is sent.
 */
export async function attachImage(endpoint, asset) {
  const uri = await prepare(asset);
  try { return await uploadStaged(endpoint, uri); }
  catch (e) { if (e.code === 'NETWORK') return PENDING + uri; throw e; }
}
