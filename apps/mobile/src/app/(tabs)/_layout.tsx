import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { Tabs } from 'expo-router/tabs';
import { Platform, StyleSheet, View, type ColorValue } from 'react-native';
import { useConversations } from '../../state/hooks';
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
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textSubtle,
        tabBarLabelStyle: { fontFamily: fonts.medium, fontSize: 11 },
        tabBarStyle: {
          position: 'absolute',
          borderTopColor: theme.colors.border,
          backgroundColor: Platform.OS === 'ios' ? 'transparent' : theme.colors.surface,
          elevation: 0,
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
          tabBarBadge: unread > 0 ? (unread > 99 ? '99+' : unread) : undefined,
        }}
      />
      <Tabs.Screen
        name="inbox"
        options={{ title: 'Client Inbox', tabBarIcon: icon('mail', 'mail-outline') }}
      />
      <Tabs.Screen
        name="activity"
        options={{ title: 'Activity', tabBarIcon: icon('notifications', 'notifications-outline') }}
      />
      <Tabs.Screen
        name="more"
        options={{ title: 'More', tabBarIcon: icon('grid', 'grid-outline') }}
      />
    </Tabs>
  );
}
