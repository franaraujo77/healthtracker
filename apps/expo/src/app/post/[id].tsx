import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useGlobalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Text, YStack } from "tamagui";

import { trpc } from "~/utils/api";

// SafeAreaView is a native API that can't use Tamagui tokens.
// Must match colorTokens.backgroundPrimary.light.
const BACKGROUND_PRIMARY = "#F9F7F4";

export default function Post() {
  const { id } = useGlobalSearchParams<{ id: string }>();
  const { data } = useQuery(trpc.post.byId.queryOptions({ id }));

  if (!data) return null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <Stack.Screen options={{ title: data.title }} />
      <YStack flex={1} padding="$4">
        <Text
          fontFamily="$body"
          fontSize="$9"
          fontWeight="700"
          color="$primaryTeal"
          paddingVertical="$2"
        >
          {data.title}
        </Text>
        <Text
          fontFamily="$body"
          fontSize="$4"
          color="$textPrimary"
          paddingVertical="$4"
        >
          {data.content}
        </Text>
      </YStack>
    </SafeAreaView>
  );
}
