import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { DefaultTheme, NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { ActivityIndicator, View } from "react-native";
import { Text } from "react-native-paper";

import { useAuthStore } from "../store/authStore";
import { palette, spacing } from "../theme";
import AssistantScreen from "../screens/AssistantScreen";
import DashboardScreen from "../screens/DashboardScreen";
import DeviceScreen from "../screens/DeviceScreen";
import EnvironmentScreen from "../screens/EnvironmentScreen";
import FocusScreen from "../screens/FocusScreen";
import LoginScreen from "../screens/LoginScreen";
import NotificationsScreen from "../screens/NotificationsScreen";
import PlansScreen from "../screens/PlansScreen";
import RegisterScreen from "../screens/RegisterScreen";
import StatsScreen from "../screens/StatsScreen";
import type { RootStackParamList, TabParamList } from "./types";

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const TAB_ICONS: Record<keyof TabParamList, React.ComponentProps<typeof MaterialCommunityIcons>["name"]> =
  {
    Home: "view-dashboard-outline",
    Focus: "timer-outline",
    Environment: "thermometer-lines",
    Stats: "chart-box-outline",
    Assistant: "robot-happy-outline",
  };

const TAB_LABELS: Record<keyof TabParamList, string> = {
  Home: "Tổng quan",
  Focus: "Tập trung",
  Environment: "Môi trường",
  Stats: "Thống kê",
  Assistant: "Trợ lý",
};

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: palette.primary,
        tabBarInactiveTintColor: palette.muted,
        tabBarLabel: TAB_LABELS[route.name],
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        tabBarStyle: {
          height: 64,
          paddingTop: 6,
          paddingBottom: 8,
          backgroundColor: palette.surface,
          borderTopColor: palette.border,
        },
        tabBarIcon: ({ color, size }) => (
          <MaterialCommunityIcons name={TAB_ICONS[route.name]} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Home" component={DashboardScreen} />
      <Tab.Screen name="Focus" component={FocusScreen} />
      <Tab.Screen name="Environment" component={EnvironmentScreen} />
      <Tab.Screen name="Stats" component={StatsScreen} />
      <Tab.Screen name="Assistant" component={AssistantScreen} />
    </Tab.Navigator>
  );
}

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    primary: palette.primary,
    background: palette.background,
    card: palette.surface,
    text: palette.text,
    border: palette.border,
  },
};

export function RootNavigator() {
  const status = useAuthStore((state) => state.status);

  if (status === "loading") {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: palette.background,
          gap: spacing.md,
        }}
      >
        <ActivityIndicator color={palette.primary} size="large" />
        <Text variant="bodyMedium" style={{ color: palette.muted }}>
          Đang khôi phục phiên đăng nhập…
        </Text>
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: "slide_from_right" }}>
        {status === "signedIn" ? (
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen name="Plans" component={PlansScreen} />
            <Stack.Screen name="Device" component={DeviceScreen} />
            <Stack.Screen name="Notifications" component={NotificationsScreen} />
          </>
        ) : (
          <>
            <Stack.Screen name="Login" component={LoginScreen} />
            <Stack.Screen name="Register" component={RegisterScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
