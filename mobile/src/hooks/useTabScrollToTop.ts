import { useNavigation, useRoute } from "@react-navigation/native";
import { useEffect, type RefObject } from "react";
import { Platform } from "react-native";

type Scrollable = {
  scrollTo?: (options: { y?: number; animated?: boolean }) => void;
  getScrollableNode?: () => { scrollTop?: number } | null | undefined;
  scrollTop?: number;
};

/**
 * Scrolls a screen back to the top when its tab is pressed again.
 *
 * The React Navigation version of this hook relies on `scrollTo`, which
 * `react-native-web` ScrollViews do not always honour, so we also fall back to
 * setting `scrollTop` on the underlying DOM node on web.
 */
export function useTabScrollToTop(ref: RefObject<unknown>) {
  const navigation = useNavigation();
  const route = useRoute();

  useEffect(() => {
    let current = navigation as typeof navigation | undefined;
    let tabNavigation: typeof navigation | undefined;

    while (current) {
      if (current.getState()?.type === "tab") {
        tabNavigation = current;
        break;
      }
      current = current.getParent() as typeof navigation | undefined;
    }

    if (!tabNavigation) {
      return;
    }

    const addTabPressListener = tabNavigation.addListener.bind(tabNavigation) as unknown as (
      type: "tabPress",
      callback: (event: { target?: string }) => void,
    ) => () => void;

    // Wait a tick so every `tabPress` listener has run before we decide.
    // On web we must not rely on `requestAnimationFrame`: it does not fire
    // while the browser tab is in the background, so the scroll would be lost.
    const schedule =
      Platform.OS === "web"
        ? (action: () => void) => {
            setTimeout(action, 0);
          }
        : (action: () => void) => {
            requestAnimationFrame(action);
          };

    return addTabPressListener("tabPress", (event) => {
      if (event.target !== route.key || !navigation.isFocused()) {
        return;
      }

      schedule(() => {
        const node = ref.current as Scrollable | null;
        if (!node) {
          return;
        }

        if (Platform.OS === "web") {
          const dom =
            typeof node.getScrollableNode === "function" ? node.getScrollableNode() : node;
          if (dom && typeof dom.scrollTop === "number") {
            dom.scrollTop = 0;
            return;
          }
        }

        node.scrollTo?.({ y: 0, animated: true });
      });
    });
  }, [navigation, ref, route.key]);
}
