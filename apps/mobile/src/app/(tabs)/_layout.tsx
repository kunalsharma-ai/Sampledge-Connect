import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router/tabs';
import { Platform, StyleSheet, View, type ColorValue } from 'react-native';
import { useConversations, useNotifications } from '../../state/hooks';
import { useInNetwork, useNet } from '../../state/useNetwork';
import { alpha, fonts } from '../../theme/themes';
import { useTheme } from '../../theme/ThemeProvider';

type IconName = keyof typeof Ionicons.glyphMap;
const icon =
  (active: IconName, inactive: IconName) =>
  ({ focused, color, size }: { focused: boolean; color: ColorValue; size: number }) => (
    <Ionicons name={focused ? active : inactive} color={color as string} size={size - 2} />
  );

/** Bottom navigation: the five destinations used most on a phone. Everything else lives under More. */
export default function TabsLayout() {
  const { theme } = useTheme();
  const { conversations } = useConversations();
  const unread = conversations.reduce((n, c) => n + c.unread, 0);
  const { unread: activity } = useNotifications();
  const badge = (n: number) => (n > 0 ? (n > 99 ? '99+' : n) : undefined);
  // SampConnect Network has People in place of the Client Inbox.
  const network = useInNetwork();
  const requests = useNet<{ incoming: unknown[] }>(network ? '/v1/network/requests' : null);
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textSubtle,
        tabBarLabelStyle: {
          fontFamily: fonts.medium,
          fontSize: 11,
          lineHeight: 14,
          paddingBottom: 2,
        },
        tabBarStyle: {
          position: 'absolute',
          borderTopColor: theme.colors.border,
          backgroundColor: Platform.OS === 'ios' ? 'transparent' : theme.colors.surface,
          elevation: 0,
          ...(Platform.OS === 'web' ? { height: 64, paddingBottom: 8 } : null),
        },
        tabBarBackground: () =>
          Platform.OS === 'ios' ? (
            <BlurView
              intensity={60}
              tint={theme.dark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            >
              <View
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: alpha(theme.colors.surface, 0.6) },
                ]}
              />
            </BlurView>
          ) : null,
        tabBarBadgeStyle: {
          backgroundColor: theme.colors.accent,
          color: theme.colors.onAccent,
          fontFamily: fonts.semibold,
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: icon('home', 'home-outline') }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarIcon: icon('chatbubbles', 'chatbubbles-outline'),
          tabBarBadge: badge(unread),
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{
          title: 'Client Inbox',
          tabBarIcon: icon('mail', 'mail-outline'),
          href: network ? null : undefined,
        }}
      />
      <Tabs.Screen
        name="people"
        options={{
          title: 'People',
          tabBarIcon: icon('people', 'people-outline'),
          tabBarBadge: badge(requests.data?.incoming.length ?? 0),
          href: network ? undefined : null,
        }}
      />
      <Tabs.Screen
        name="activity"
        options={{
          title: 'Activity',
          tabBarIcon: icon('notifications', 'notifications-outline'),
          tabBarBadge: badge(activity),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', tabBarIcon: icon('grid', 'grid-outline') }}
      />
    </Tabs>
  );
}
