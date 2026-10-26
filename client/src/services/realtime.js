import { io } from 'socket.io-client';
import { isDemo, renewSession } from './api';
const base = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
// One shared socket for the whole app. It authenticates with the same HttpOnly access-token cookie as the API,
// so it must reconnect whenever the signed-in user changes (see AppProvider).
export const socket = isDemo ? null : io(base || undefined, { autoConnect: false, withCredentials: true, transports: ['websocket', 'polling'], reconnectionDelayMax: 8000 });
// A refused handshake is not retried by Socket.IO, so renew the token and connect again ourselves.
// One renewal per run of refusals, so a token that keeps failing cannot loop.
let renewedFor = false;
socket?.on('connect_error', async err => {
  if (err?.message !== 'TOKEN_EXPIRED' || renewedFor) return;
  renewedFor = true;
  await renewSession();
  socket.connect();
});
socket?.on('connect', () => { renewedFor = false; });
export const connectRealtime = () => { if (socket && !socket.connected) socket.connect(); };
export const reauthRealtime = () => { if (!socket) return; socket.disconnect(); socket.connect(); };
export const toBytes = data => data instanceof Uint8Array ? data : new Uint8Array(data);
