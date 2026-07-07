<script setup lang="ts">
import { onMounted } from "vue";
import KanbanView from "./components/KanbanView.vue";
import { useSessions } from "./composables/useSessions";
import { useFaviconState } from "./composables/useFaviconState";
import { useSoundEnabled } from "./composables/useSoundEnabled";
import { useAttentionSound } from "./composables/useAttentionSound";
import { useUnloadGuard } from "./composables/useUnloadGuard";
import { useAppConfig } from "./composables/useAppConfig";

// Kanban is the app shell. Keep the global side effects that belong to session
// activity: unload guard, attention sound, and favicon state.
useUnloadGuard();

const { sessions } = useSessions();
const { enabled: soundEnabled } = useSoundEnabled();
const { soundFile, loadConfig } = useAppConfig();
useAttentionSound(soundEnabled, soundFile);
useFaviconState(sessions);
onMounted(loadConfig);
</script>

<template>
  <KanbanView />
</template>
