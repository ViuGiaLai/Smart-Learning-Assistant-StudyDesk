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
  ForgotPassword: { email?: string } | undefined;
  ResetPassword: { url: string };
  Main: NavigatorScreenParams<TabParamList> | undefined;
  Plans: undefined;
  Device: { register?: boolean } | undefined;
  Notifications: undefined;
};
