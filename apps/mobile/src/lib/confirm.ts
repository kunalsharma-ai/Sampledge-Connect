import { Alert, Platform } from 'react-native';

/**
 * Asks before a destructive step on phones. The web preview runs it straight away, because
 * browser dialogs block the page (the same rule message delete follows).
 */
export function confirmThen(title: string, message: string, action: string, go: () => void): void {
  if (Platform.OS === 'web') return go();
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: action, style: 'destructive', onPress: go },
  ]);
}
