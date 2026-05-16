"use client";

import { useForm } from "@tanstack/react-form";
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";

import type { RouterOutputs } from "@healthtracker/api";
import { CreatePostSchema } from "@healthtracker/db/schema";
import { Button } from "@healthtracker/ui/button";
import { Input } from "@healthtracker/ui/input";
import { Label } from "@healthtracker/ui/label";

import { useTRPC } from "~/trpc/react";

export function CreatePostForm() {
  const trpc = useTRPC();

  const queryClient = useQueryClient();
  const createPost = useMutation(
    trpc.post.create.mutationOptions({
      onSuccess: async () => {
        form.reset();
        await queryClient.invalidateQueries(trpc.post.pathFilter());
      },
    }),
  );

  const form = useForm({
    defaultValues: {
      content: "",
      title: "",
    },
    validators: {
      onSubmit: CreatePostSchema,
    },
    onSubmit: (data) => createPost.mutate(data.value),
  });

  return (
    <form
      className="w-full max-w-2xl space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Field
        name="title"
        children={(field) => (
          <div className="flex flex-col gap-1">
            <Label htmlFor={field.name}>Title</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChangeText={(v) => field.handleChange(v)}
              placeholder="Title"
            />
          </div>
        )}
      />
      <form.Field
        name="content"
        children={(field) => (
          <div className="flex flex-col gap-1">
            <Label htmlFor={field.name}>Content</Label>
            <Input
              id={field.name}
              value={field.state.value}
              onBlur={field.handleBlur}
              onChangeText={(v) => field.handleChange(v)}
              placeholder="Content"
            />
          </div>
        )}
      />
      <Button
        onPress={() => {
          void form.handleSubmit();
        }}
      >
        Create Post
      </Button>
    </form>
  );
}

export function PostList() {
  const trpc = useTRPC();
  const { data: posts } = useSuspenseQuery(trpc.post.all.queryOptions());

  if (posts.length === 0) {
    return (
      <div className="relative flex w-full flex-col gap-4">
        <PostCardSkeleton pulse={false} />
        <PostCardSkeleton pulse={false} />
        <PostCardSkeleton pulse={false} />
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/10">
          <p className="text-2xl font-bold text-white">No posts yet</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      {posts.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
    </div>
  );
}

export function PostCard(props: {
  post: RouterOutputs["post"]["all"][number];
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const deletePost = useMutation(
    trpc.post.delete.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(trpc.post.pathFilter());
      },
    }),
  );

  return (
    <div className="flex flex-row rounded-lg bg-stone-100 p-4">
      <div className="grow">
        <h2 className="text-2xl font-bold text-teal-700">{props.post.title}</h2>
        <p className="mt-2 text-sm">{props.post.content}</p>
      </div>
      <div>
        <Button
          variant="ghost"
          onPress={() => deletePost.mutate(props.post.id)}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}

export function PostCardSkeleton(props: { pulse?: boolean }) {
  const { pulse = true } = props;
  return (
    <div className="flex flex-row rounded-lg bg-stone-100 p-4">
      <div className="grow">
        <div
          className={`h-8 w-1/4 rounded bg-stone-300 ${pulse ? "animate-pulse" : ""}`}
        />
        <div
          className={`mt-2 h-4 w-1/3 rounded bg-stone-200 ${pulse ? "animate-pulse" : ""}`}
        />
      </div>
    </div>
  );
}
