import { useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams } from "expo-router";
import { Button, Text, View, YStack } from "tamagui";

import {
  LETTER_PREMIUM_REQUIRED_PT_BR,
  LETTER_PREMIUM_UPGRADE_CTA_PT_BR,
  LETTER_PREPARING_PT_BR,
  LETTER_UNAVAILABLE_PT_BR,
  letterAuthorAttributionPtBr,
  letterReaderAriaLabelPtBr,
} from "@healthtracker/validators";

import { useLetterStream } from "~/hooks/use-letter-stream";

const LETTER_BACKGROUND = "#F9F1E6"; // warm off-white (UX spec §874)
const LETTER_TEXT_COLOR = "#1F1B16";
const LETTER_BODY_FONT = "Lora_400Regular";

/**
 * Story 4.1 — full-screen LetterReader (AC5, AC6, AC8, AC9, AC10, AC11).
 *
 * Per UX-DR11 the bottom tab bar is NOT hidden — Expo Router 6's
 * `presentation: 'fullScreenModal'` keeps the parent tab bar visible
 * by default; we deliberately rely on that behaviour.
 *
 * Streaming animation respects `prefers-reduced-motion` per AC8: when
 * the OS reports reduce-motion, body text updates aren't animated
 * (the underlying SSE stream still fans out tokens; the renderer just
 * doesn't gate them on layout transitions). Story 4.1 ships without
 * per-token reveal animation, so this flag is forward-compat for the
 * Story 4.2 re-read flow that may animate; the hook is wired so the
 * subscription is in place when that lands.
 */
export default function LetterReaderScreen(): React.ReactNode {
  const params = useLocalSearchParams<{ letterId: string }>();
  const letterId = String(params.letterId);
  const stream = useLetterStream(letterId);
  const reduceMotion = useReduceMotion();
  void reduceMotion;

  const formattedDate = useMemo(() => {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long" }).format(
      new Date(),
    );
  }, []);
  const ariaLabel = letterReaderAriaLabelPtBr(formattedDate);
  const authorAttribution = letterAuthorAttributionPtBr(formattedDate);

  const isPremiumGate =
    stream.status === "error" && stream.code === "PREMIUM_REQUIRED";
  const isError = stream.status === "error" && !isPremiumGate;
  const body =
    stream.status === "streaming" || stream.status === "complete"
      ? stream.body
      : "";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: LETTER_BACKGROUND }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        contentContainerStyle={{ padding: 24, paddingBottom: 48 }}
        accessibilityLabel={ariaLabel}
      >
        {/* RN's accessibilityRole has no 'article'; the apps/web
            counterpart wraps in <article> for parity. */}
        <View accessibilityLiveRegion="polite" accessible>
          {stream.status === "connecting" ? (
            <Text
              style={{ fontFamily: LETTER_BODY_FONT }}
              fontSize={17}
              lineHeight={28}
              color={LETTER_TEXT_COLOR}
            >
              {LETTER_PREPARING_PT_BR}
            </Text>
          ) : null}
          {body.length > 0 ? (
            <Text
              style={{ fontFamily: LETTER_BODY_FONT }}
              fontSize={17}
              lineHeight={28}
              color={LETTER_TEXT_COLOR}
            >
              {body}
            </Text>
          ) : null}
          {isError ? (
            <Text
              style={{ fontFamily: LETTER_BODY_FONT }}
              fontSize={17}
              lineHeight={28}
              color={LETTER_TEXT_COLOR}
            >
              {LETTER_UNAVAILABLE_PT_BR}
            </Text>
          ) : null}
          {isPremiumGate ? (
            <YStack space="$3">
              <Text
                style={{ fontFamily: LETTER_BODY_FONT }}
                fontSize={17}
                lineHeight={28}
                color={LETTER_TEXT_COLOR}
              >
                {LETTER_PREMIUM_REQUIRED_PT_BR}
              </Text>
              <Button>{LETTER_PREMIUM_UPGRADE_CTA_PT_BR}</Button>
            </YStack>
          ) : null}
        </View>
        {stream.status === "complete" ? (
          <Text
            marginTop="$6"
            style={{ fontFamily: LETTER_BODY_FONT }}
            fontSize={14}
            lineHeight={20}
            color={LETTER_TEXT_COLOR}
          >
            {authorAttribution}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (!cancelled) setReduce(v);
    });
    const sub = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (next) => {
        setReduce(next);
      },
    );
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);
  return reduce;
}
