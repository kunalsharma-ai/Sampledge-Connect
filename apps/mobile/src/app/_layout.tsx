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
import { ActionRefusedBanner } from '../components/ActionRefusedBanner';
import { MeetingReminderBanner } from '../components/MeetingReminderBanner';
import { NotificationBanner } from '../components/NotificationBanner';
import { PushOpenHandler } from '../components/PushOpenHandler';
import { BrandingSync } from '../components/BrandingSync';
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
      <BrandingSync />
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
          <Stack.Screen name="settings/profile" options={{ title: 'Profile' }} />
          <Stack.Screen name="person/[id]" options={{ title: '' }} />
          <Stack.Screen name="sso" options={{ headerShown: false }} />
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
          <Stack.Screen name="booking-pages/index" options={{ title: 'Booking pages' }} />
          <Stack.Screen name="booking-pages/[id]" options={{ title: 'Booking page' }} />
          <Stack.Screen name="settings/working-hours" options={{ title: 'Working hours' }} />
          <Stack.Screen name="settings/status" options={{ title: 'Status' }} />
          <Stack.Screen name="recordings" options={{ title: 'Recordings' }} />
          <Stack.Screen name="files" options={{ title: 'Files' }} />
          <Stack.Screen name="forward" options={{ title: 'Forward', presentation: 'modal' }} />
          <Stack.Screen name="admin/integrations" options={{ title: 'Integrations' }} />
          <Stack.Screen name="admin/branding" options={{ title: 'Branding' }} />
          <Stack.Screen name="admin/index" options={{ title: 'Administration' }} />
          <Stack.Screen name="admin/members" options={{ title: 'Members' }} />
          <Stack.Screen
            name="admin/add-member"
            options={{ title: 'Add member', presentation: 'modal' }}
          />
          <Stack.Screen name="admin/audit" options={{ title: 'Audit log' }} />
          <Stack.Screen name="admin/devices" options={{ title: 'Devices' }} />
          <Stack.Screen name="pinned/[id]" options={{ title: 'Pinned' }} />
          <Stack.Screen name="saved" options={{ title: 'Saved messages' }} />
          <Stack.Screen name="scheduled" options={{ title: 'Scheduled messages' }} />
          <Stack.Screen name="poll/new" options={{ title: 'New poll', presentation: 'modal' }} />
          <Stack.Screen name="tasks" options={{ title: 'Tasks & Approvals' }} />
          <Stack.Screen name="assistant" options={{ title: 'AI Assistant' }} />
          <Stack.Screen name="summary/[id]" options={{ title: 'Summary' }} />
          <Stack.Screen name="task/[id]" options={{ title: 'Task' }} />
          <Stack.Screen name="task/new" options={{ title: 'New task', presentation: 'modal' }} />
          <Stack.Screen name="approval/[id]" options={{ title: 'Approval' }} />
          <Stack.Screen
            name="approval/new"
            options={{ title: 'Request approval', presentation: 'modal' }}
          />
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
          <ActionRefusedBanner />
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
