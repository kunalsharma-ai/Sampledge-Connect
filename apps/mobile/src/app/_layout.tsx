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
import { HeaderTitleWithHelp } from '../components/FeatureHelp';
import { ROUTE_HELP } from '../lib/featureHelpRoutes';
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
        screenOptions={({ route }) => ({
          // Screens with a feature guide show the gold help mark beside their title.
          ...(ROUTE_HELP[route.name]
            ? {
                headerTitle: ({ children }: { children: string }) => (
                  <HeaderTitleWithHelp title={children} id={ROUTE_HELP[route.name]!} />
                ),
              }
            : null),
          headerShadowVisible: false,
          headerStyle: { backgroundColor: theme.colors.background },
          headerTintColor: theme.colors.accent,
          headerTitleStyle: { fontFamily: fonts.semibold, color: theme.colors.text },
          contentStyle: { backgroundColor: theme.colors.background },
          animation: motion.base ? 'default' : 'none',
          headerBackButtonDisplayMode: 'minimal',
        })}
      >
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="conversation/[id]" options={{ title: '' }} />
          <Stack.Screen name="search" options={{ title: 'Search', presentation: 'modal' }} />
          <Stack.Screen name="settings/appearance" options={{ title: 'Appearance' }} />
          <Stack.Screen name="settings/storage" options={{ title: 'Offline & storage' }} />
          <Stack.Screen name="settings/notifications" options={{ title: 'Notifications' }} />
          <Stack.Screen name="settings/devices" options={{ title: 'Devices' }} />
          <Stack.Screen name="settings/password" options={{ title: 'Password' }} />
          <Stack.Screen name="settings/profile" options={{ title: 'Profile' }} />
          <Stack.Screen name="person/[id]" options={{ title: '' }} />
          <Stack.Screen name="network/person/[id]" options={{ title: '' }} />
          <Stack.Screen name="network/invite" options={{ title: 'Invite to SampConnect' }} />
          <Stack.Screen name="network/blocked" options={{ title: 'Blocked people' }} />
          <Stack.Screen name="network/profile" options={{ title: 'Network profile' }} />
          <Stack.Screen name="network/communities/index" options={{ title: 'Communities' }} />
          <Stack.Screen name="network/communities/[id]" options={{ title: '' }} />
          <Stack.Screen
            name="network/communities/new"
            options={{ title: 'New community', presentation: 'modal' }}
          />
          <Stack.Screen
            name="network/communities/group"
            options={{ title: 'New group', presentation: 'modal' }}
          />
          <Stack.Screen
            name="network/status/new"
            options={{ title: 'New status', presentation: 'modal' }}
          />
          <Stack.Screen
            name="network/status/[userId]"
            options={{ headerShown: false, presentation: 'fullScreenModal' }}
          />
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
          <Stack.Screen name="settings/chat-theme" options={{ title: 'Chat theme' }} />
          <Stack.Screen name="settings/call-background" options={{ title: 'Call background' }} />
          <Stack.Screen name="settings/call-appearance" options={{ title: 'How you look' }} />
          <Stack.Screen name="minutes/index" options={{ title: 'Minutes of meetings' }} />
          <Stack.Screen name="minutes/[callId]" options={{ title: 'Minutes' }} />
          <Stack.Screen name="export-chat" options={{ title: 'Export chat' }} />
          <Stack.Screen name="transcript/[attachmentId]" options={{ title: 'Transcript' }} />
          <Stack.Screen name="chat-background" options={{ title: 'Chat background' }} />
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
          <Stack.Screen name="admin/moderation" options={{ title: 'Reported content' }} />
          <Stack.Screen name="admin/devices" options={{ title: 'Devices' }} />
          <Stack.Screen name="platform/index" options={{ title: 'Super admin' }} />
          <Stack.Screen name="platform/orgs" options={{ title: 'Organizations' }} />
          <Stack.Screen name="platform/org/[id]" options={{ title: 'Organization' }} />
          <Stack.Screen name="platform/admins" options={{ title: 'Platform admins' }} />
          <Stack.Screen name="platform/audit" options={{ title: 'Audit log' }} />
          <Stack.Screen name="platform/activity" options={{ title: 'Activity' }} />
          <Stack.Screen name="platform/permissions" options={{ title: 'Permissions' }} />
          <Stack.Screen name="pinned/[id]" options={{ title: 'Pinned' }} />
          <Stack.Screen name="saved" options={{ title: 'Saved messages' }} />
          <Stack.Screen name="help/index" options={{ title: 'Help' }} />
          <Stack.Screen
            name="help/ask"
            options={{ title: 'Ask a question', presentation: 'modal' }}
          />
          <Stack.Screen name="help/query/[id]" options={{ title: 'Question' }} />
          <Stack.Screen name="scheduled" options={{ title: 'Scheduled messages' }} />
          <Stack.Screen name="poll/new" options={{ title: 'New poll', presentation: 'modal' }} />
          <Stack.Screen name="tasks" options={{ title: 'Tasks & Approvals' }} />
          <Stack.Screen name="inbox/[id]" options={{ title: '' }} />
          <Stack.Screen name="inbox/details/[id]" options={{ title: 'Details' }} />
          <Stack.Screen
            name="inbox/new"
            options={{ title: 'Log a conversation', presentation: 'modal' }}
          />
          <Stack.Screen name="inbox/dashboard" options={{ title: 'Inbox dashboard' }} />
          <Stack.Screen name="inbox/settings" options={{ title: 'Inbox settings' }} />
          <Stack.Screen name="inbox/channels/index" options={{ title: 'Channels' }} />
          <Stack.Screen name="inbox/channels/add" options={{ title: 'Add channel' }} />
          <Stack.Screen name="inbox/channels/[id]" options={{ title: 'Channel' }} />
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
