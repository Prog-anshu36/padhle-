# SyncStudy

Real-time synchronized YouTube study rooms using the official YouTube IFrame Player API and Supabase Realtime.

## Configure

1. Create a Supabase project and run `supabase/schema.sql` in its SQL editor.
2. Copy the project URL and anonymous publishable key into `dist/config.js`.
3. Serve `dist/` with any static host. Room routes use client-side routing, so configure the host to fall back to `index.html`.

Without Supabase values, the app deliberately labels itself **Demo mode** and synchronizes tabs on the same browser using BroadcastChannel. Cross-device real-time sync is enabled only when Supabase is configured.

## Architecture

- `rooms` is the authoritative state. Updates receive a UUID event ID and server timestamp; last-write-wins ordering resolves simultaneous controls.
- Broadcast messages reduce latency; Postgres changes provide durable reconciliation and reconnect recovery.
- Playback position is projected from the authoritative timestamp and speed. Clients check drift every five seconds and correct only beyond 1.5 seconds.
- Presence is ephemeral and tracks anonymous participant names. Volume remains local.
- YouTube supported playback rates are checked per video; unsupported requested rates fall back to the nearest supported value.
- Messages and bookmarks persist. Shared notes and timer live in the room state.

## Verification

Open the same room in two browsers (or tabs in Demo mode), load an embeddable YouTube URL, then test play, pause, seek, speed, reconnect, chat, notes, timer and bookmarks. Test mobile layout at 390px, tablet at 768px and desktop at 1440px.

## Vercel

Import this directory, set the output directory to `dist`, and add a rewrite from `/(.*)` to `/index.html`. Supabase keys used by the browser are intentionally public; RLS and the restricted RPCs enforce access.

