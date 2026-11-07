import { Alert as NativeAlert, Platform } from 'react-native';

/**
 * `Alert.alert` with the same shape on every platform. React Native's own does nothing in a
 * browser, which would leave the web preview with buttons that silently do nothing, so there
 * a confirm box stands in: OK runs the last non-cancel button, Cancel runs nothing.
 */
export const Alert = {
  alert(title, message, buttons) {
    if (Platform.OS !== 'web') return NativeAlert.alert(title, message, buttons);
    const text = [title, message].filter(Boolean).join('\n\n');
    const action = (buttons || []).filter(b => b.style !== 'cancel').pop();
    if (!buttons || buttons.length < 2) { window.alert(text); return buttons?.[0]?.onPress?.(); }
    if (window.confirm(text)) action?.onPress?.();
  },
};
