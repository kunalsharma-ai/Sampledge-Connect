import '../lib/platformRandom';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useRef } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IncomingCall } from '../calls/IncomingCall';
import { MeetingReminderBanner } from '../components/MeetingReminderBanner';
import { NotificationBanner } from '../components/NotificationBanner';
import { PushOpenHandler } from '../components/PushOpenHandler';
import { AppProvider, useApp } from '../state/AppProvider';
import { fonts } from '../theme/themes';
import { ThemeProvider, useTheme } from '../theme/ThemeProvider';

void SplashScreen.preventAutoHideAsync();

function RootStack() {
  const { theme, motion } = useTheme();
  const { sessionState, workspace } = useApp();
  const hasSession =
    sessionState === 'active' || sessionState === 'expired' || sessionState === 'demo';
  // Protected screens need the local database, so they open only once it is ready.
  const signedIn = hasSession && workspace !== null;
  // Hold the splash screen only for the first load; after that the navigator stays mounted
  // (unmounting it while a newly signed-in account's database opens would lose the route).
  const booted = useRef(false);
  if (sessionState !== 'loading' && (!hasSession || workspace !== null)) booted.current = true;
  const ready = booted.current;

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.colors.background);
  }, [theme]);
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;

  return (
    <>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.colors.background },
          headerTintColor: theme.colors.accent,
          headerTitleStyle: { fontFamily: fonts.semibold, color: theme.colors.text },
          contentStyle: { backgroundColor: theme.colors.background },
          animation: motion.base ? 'default' : 'none',
          headerBackButtonDisplayMode: 'minimal',
        }}
      >
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="conversation/[id]" options={{ title: '' }} />
          <Stack.Screen name="search" options={{ title: 'Search', presentation: 'modal' }} />
          <Stack.Screen name="settings/appearance" options={{ title: 'Appearance' }} />
          <Stack.Screen name="settings/storage" options={{ title: 'Offline & storage' }} />
          <Stack.Screen name="settings/notifications" options={{ title: 'Notifications' }} />
          <Stack.Screen name="settings/devices" options={{ title: 'Devices' }} />
          <Stack.Screen
            name="new-conversation"
            options={{ title: 'New conversation', presentation: 'modal' }}
          />
          <Stack.Screen name="channels" options={{ title: 'Browse channels' }} />
          <Stack.Screen name="meetings/index" options={{ title: 'Meetings' }} />
          <Stack.Screen
            name="meetings/new"
            options={{ title: 'Schedule a meeting', presentation: 'modal' }}
          />
          <Stack.Screen name="meeting/[id]" options={{ title: 'Meeting' }} />
          <Stack.Screen name="settings/working-hours" options={{ title: 'Working hours' }} />
          <Stack.Screen name="recordings" options={{ title: 'Recordings' }} />
          <Stack.Screen name="conversation-info/[id]" options={{ title: 'Details' }} />
          <Stack.Screen
            name="add-members/[id]"
            options={{ title: 'Add people', presentation: 'modal' }}
          />
          <Stack.Screen name="planned/[module]" options={{ title: '' }} />
          <Stack.Screen
            name="call/[id]"
            options={{ headerShown: false, presentation: 'fullScreenModal', gestureEnabled: false }}
          />
        </Stack.Protected>
        <Stack.Screen
          name="sign-in"
          options={{ headerShown: false, presentation: signedIn ? 'modal' : 'card' }}
        />
      </Stack>
      {signedIn ? (
        <>
          <NotificationBanner />
          <MeetingReminderBanner />
          <PushOpenHandler />
          <IncomingCall />
        </>
      ) : null}
    </>
  );
}

export default function RootLayout() {
  const [loaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  if (!loaded) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <AppProvider>
            <RootStack />
          </AppProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
