import { useState } from "react";
import { Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, Stack } from "expo-router";
import { LegendList } from "@legendapp/list";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Text, XStack, YStack } from "tamagui";

import { Button } from "@healthtracker/ui/button";
import { Input } from "@healthtracker/ui/input";

import type { RouterOutputs } from "~/utils/api";
import { trpc } from "~/utils/api";

// SafeAreaView is a native API that can't use Tamagui tokens.
// Must match colorTokens.backgroundPrimary.light.
const BACKGROUND_PRIMARY = "#F9F7F4";

function PostCard(props: {
  post: RouterOutputs["post"]["all"][number];
  onDelete: () => void;
}) {
  return (
    <XStack
      backgroundColor="$surface"
      borderRadius="$card"
      padding="$4"
      gap="$2"
    >
      <YStack flex={1}>
        <Link
          asChild
          href={{
            pathname: "/post/[id]",
            params: { id: props.post.id },
          }}
        >
          <Pressable>
            <Text
              fontFamily="$body"
              fontSize="$6"
              fontWeight="600"
              color="$primaryTeal"
            >
              {props.post.title}
            </Text>
            <Text
              fontFamily="$body"
              fontSize="$4"
              color="$textPrimary"
              marginTop="$2"
            >
              {props.post.content}
            </Text>
          </Pressable>
        </Link>
      </YStack>
      <Button variant="ghost" size="sm" onPress={props.onDelete}>
        Delete
      </Button>
    </XStack>
  );
}

function CreatePost() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const { mutate, error } = useMutation(
    trpc.post.create.mutationOptions({
      async onSuccess() {
        setTitle("");
        setContent("");
        await queryClient.invalidateQueries(trpc.post.all.queryFilter());
      },
    }),
  );

  return (
    <YStack marginTop="$4" gap="$2">
      <Input value={title} onChangeText={setTitle} placeholder="Title" />
      {error?.data?.zodError?.fieldErrors.title && (
        <Text fontFamily="$body" fontSize="$3" color="$error" marginBottom="$2">
          {error.data.zodError.fieldErrors.title}
        </Text>
      )}
      <Input value={content} onChangeText={setContent} placeholder="Content" />
      {error?.data?.zodError?.fieldErrors.content && (
        <Text fontFamily="$body" fontSize="$3" color="$error" marginBottom="$2">
          {error.data.zodError.fieldErrors.content}
        </Text>
      )}
      <Button onPress={() => mutate({ title, content })}>Create</Button>
      {error?.data?.code === "UNAUTHORIZED" && (
        <Text fontFamily="$body" fontSize="$3" color="$error" marginTop="$2">
          You need to be logged in to create a post
        </Text>
      )}
    </YStack>
  );
}

export default function Index() {
  const queryClient = useQueryClient();
  const postQuery = useQuery(trpc.post.all.queryOptions());
  const deletePostMutation = useMutation(
    trpc.post.delete.mutationOptions({
      onSettled: () =>
        queryClient.invalidateQueries(trpc.post.all.queryFilter()),
    }),
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: BACKGROUND_PRIMARY }}>
      <Stack.Screen options={{ title: "Health Tracker" }} />
      <YStack flex={1} backgroundColor="$backgroundPrimary" padding="$4">
        <Text
          fontFamily="$body"
          fontSize={48}
          fontWeight="700"
          textAlign="center"
          color="$textPrimary"
          paddingBottom="$2"
        >
          Health <Text color="$primaryTeal">Tracker</Text>
        </Text>

        <YStack paddingVertical="$2">
          <Text
            fontFamily="$body"
            color="$primaryTeal"
            fontWeight="600"
            fontStyle="italic"
          >
            Press on a post
          </Text>
        </YStack>

        <LegendList
          data={postQuery.data ?? []}
          estimatedItemSize={20}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={() => <YStack height="$2" />}
          renderItem={(p) => (
            <PostCard
              post={p.item}
              onDelete={() => deletePostMutation.mutate(p.item.id)}
            />
          )}
        />

        <CreatePost />
      </YStack>
    </SafeAreaView>
  );
}
