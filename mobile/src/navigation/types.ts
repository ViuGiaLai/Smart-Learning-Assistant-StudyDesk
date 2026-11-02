import type { NavigatorScreenParams } from "@react-navigation/native";

export type TabParamList = {
  Home: undefined;
  Focus: undefined;
  Environment: undefined;
  Stats: undefined;
  Assistant: undefined;
};

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  Main: NavigatorScreenParams<TabParamList> | undefined;
  Plans: undefined;
  Device: { register?: boolean } | undefined;
  Notifications: undefined;
};
