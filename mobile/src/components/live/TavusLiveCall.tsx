import Ionicons from "@expo/vector-icons/Ionicons";
import Daily, {
  DailyMediaView,
  type DailyCall,
  type DailyParticipant,
  type DailyParticipantsObject,
} from "@daily-co/react-native-daily-js";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import {
  createMobileTavusConversation,
  endMobileTavusConversation,
  parseTavusAppMessage,
  resolveTavusToolCall,
  type TavusTranscriptTurn,
} from "@/lib/tavus-live";

interface TavusLiveCallProps {
  conversationalContext: string;
  executeTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  onTranscriptComplete: (turns: readonly TavusTranscriptTurn[]) => void;
  onEnded: () => void;
}

function mediaTrack(participant: DailyParticipant | null, kind: "audio" | "video" | "screenAudio" | "screenVideo") {
  return participant?.tracks[kind]?.persistentTrack ?? null;
}

function participantsFrom(call: DailyCall): DailyParticipantsObject | null {
  const participants = call.participants();
  return participants.local ? participants : null;
}

function Control({
  icon,
  label,
  active = false,
  danger = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  active?: boolean;
  danger?: boolean;
  onPress: () => void;
}) {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.control,
        active ? styles.controlActive : null,
        danger ? styles.controlDanger : null,
        pressed ? styles.controlPressed : null,
      ]}
    >
      <Ionicons name={icon} size={20} color={danger ? theme.colors.error : theme.colors.text} />
      <Text style={[styles.controlLabel, danger ? styles.dangerText : null]}>{label}</Text>
    </Pressable>
  );
}

export function TavusLiveCall({ conversationalContext, executeTool, onTranscriptComplete, onEnded }: TavusLiveCallProps) {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const [participants, setParticipants] = useState<DailyParticipantsObject | null>(null);
  const [status, setStatus] = useState("Preparing KeatingBot…");
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<TavusTranscriptTurn[]>([]);
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [screenOn, setScreenOn] = useState(false);
  const callRef = useRef<DailyCall | null>(null);
  const conversationIdRef = useRef<string | null>(null);
  const terminationTokenRef = useRef<string | null>(null);
  const turnsRef = useRef<TavusTranscriptTurn[]>([]);
  const seenUtterancesRef = useRef(new Set<string>());
  const handledToolsRef = useRef(new Map<string, Promise<unknown>>());
  const endingRef = useRef(false);
  const mountedRef = useRef(true);
  const executeToolRef = useRef(executeTool);
  const transcriptCompleteRef = useRef(onTranscriptComplete);
  const onEndedRef = useRef(onEnded);
  executeToolRef.current = executeTool;
  transcriptCompleteRef.current = onTranscriptComplete;
  onEndedRef.current = onEnded;

  const syncParticipants = useCallback(() => {
    const call = callRef.current;
    if (!call || call.isDestroyed()) return;
    const next = participantsFrom(call);
    if (!next) return;
    setParticipants({ ...next });
    setMicOn(call.localAudio());
    setCameraOn(call.localVideo());
    setScreenOn(call.localScreenVideo());
  }, []);

  const finish = useCallback(async (notify = true) => {
    if (endingRef.current) {
      if (notify) onEndedRef.current();
      return;
    }
    endingRef.current = true;
    const call = callRef.current;
    callRef.current = null;
    if (mountedRef.current) setStatus("Saving this conversation…");
    transcriptCompleteRef.current(turnsRef.current);
    if (call && !call.isDestroyed()) {
      await call.leave().catch(() => undefined);
      await call.destroy().catch(() => undefined);
    }
    const conversationId = conversationIdRef.current;
    const terminationToken = terminationTokenRef.current;
    conversationIdRef.current = null;
    terminationTokenRef.current = null;
    if (conversationId && terminationToken) await endMobileTavusConversation(conversationId, terminationToken).catch(() => undefined);
    if (notify) onEndedRef.current();
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const abort = new AbortController();
    let call: DailyCall | null = null;

    const start = async () => {
      try {
        const conversation = await createMobileTavusConversation(conversationalContext, abort.signal);
        if (abort.signal.aborted) {
          await endMobileTavusConversation(conversation.conversationId, conversation.terminationToken).catch(() => undefined);
          return;
        }
        conversationIdRef.current = conversation.conversationId;
        terminationTokenRef.current = conversation.terminationToken;
        call = Daily.createCallObject({
          startAudioOff: false,
          startVideoOff: false,
          userName: "Learner",
        });
        callRef.current = call;
        const update = () => syncParticipants();
        call.on("participant-joined", update);
        call.on("participant-updated", update);
        call.on("participant-left", update);
        call.on("joined-meeting", () => {
          setStatus("Live with KeatingBot");
          syncParticipants();
        });
        call.on("left-meeting", () => {
          if (!endingRef.current) void finish();
        });
        call.on("error", (event) => {
          setError(event.errorMsg || "The live call encountered an error.");
        });
        call.on("app-message", (message) => {
          const parsed = parseTavusAppMessage(message.data);
          if (parsed.kind === "speaking") {
            setStatus(parsed.speaker === "keating" ? "KeatingBot is speaking" : "Listening to you");
            return;
          }
          if (parsed.kind === "utterance") {
            if (seenUtterancesRef.current.has(parsed.id)) return;
            seenUtterancesRef.current.add(parsed.id);
            const next = [...turnsRef.current, { role: parsed.role, text: parsed.text }];
            turnsRef.current = next;
            setTurns(next);
            return;
          }
          if (parsed.kind !== "tool-call") return;
          const existing = handledToolsRef.current.get(parsed.call.callId);
          if (existing) {
            void existing.then((result) => {
              const active = callRef.current;
              if (active && !active.isDestroyed()) active.sendAppMessage(result, "*");
            });
            return;
          }
          const task = resolveTavusToolCall(parsed.call, executeToolRef.current).then((result) => {
            const active = callRef.current;
            if (active && !active.isDestroyed()) active.sendAppMessage(result, "*");
            return result;
          });
          handledToolsRef.current.set(parsed.call.callId, task);
        });
        setStatus("Joining KeatingBot…");
        await call.join({ url: conversation.embedUrl });
      } catch (cause) {
        // Allocation may have succeeded before Daily creation or join failed.
        await finish(false);
        if (abort.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : "KeatingBot could not start.");
        setStatus("Could not join Live");
      }
    };
    void start();
    return () => {
      mountedRef.current = false;
      abort.abort();
      if (!endingRef.current) void finish(false);
    };
  }, [conversationalContext, finish, syncParticipants]);

  const local = participants?.local ?? null;
  const remote = participants
    ? Object.values(participants).find((participant) => !participant.local) ?? null
    : null;
  const remoteVideo = mediaTrack(remote, "screenVideo") ?? mediaTrack(remote, "video");
  const remoteAudio = mediaTrack(remote, "screenAudio") ?? mediaTrack(remote, "audio");

  const toggleMic = () => {
    const call = callRef.current;
    if (!call) return;
    call.setLocalAudio(!call.localAudio());
    syncParticipants();
  };
  const toggleCamera = () => {
    const call = callRef.current;
    if (!call) return;
    call.setLocalVideo(!call.localVideo());
    syncParticipants();
  };
  const toggleScreen = () => {
    const call = callRef.current;
    if (!call) return;
    try {
      if (call.localScreenVideo()) call.stopScreenShare();
      else call.startScreenShare();
      setTimeout(syncParticipants, 250);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Screen sharing is unavailable on this device.");
    }
  };

  return (
    <View style={styles.root}>
      <View style={styles.videoStage} accessibilityLabel="KeatingBot live video">
        {remoteVideo || remoteAudio ? (
          <DailyMediaView
            videoTrack={remoteVideo}
            audioTrack={remoteAudio}
            objectFit="cover"
            style={styles.remoteVideo}
          />
        ) : (
          <View style={styles.waiting}>
            <ActivityIndicator color={theme.colors.primary} />
            <Text style={styles.waitingText}>{status}</Text>
          </View>
        )}
        {local && mediaTrack(local, "video") ? (
          <DailyMediaView
            videoTrack={mediaTrack(local, "video")}
            audioTrack={null}
            mirror
            zOrder={1}
            objectFit="cover"
            style={styles.localVideo}
          />
        ) : null}
        <View style={styles.statusBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.statusText}>{status}</Text>
        </View>
      </View>

      {error ? (
        <View accessibilityRole="alert" style={styles.errorBanner}>
          <Ionicons name="warning-outline" size={18} color={theme.colors.error} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.controls}>
        <Control icon={micOn ? "mic-outline" : "mic-off-outline"} label={micOn ? "Mute" : "Unmute"} active={!micOn} onPress={toggleMic} />
        <Control icon={cameraOn ? "videocam-outline" : "videocam-off-outline"} label={cameraOn ? "Camera off" : "Camera on"} active={!cameraOn} onPress={toggleCamera} />
        <Control icon="phone-portrait-outline" label={screenOn ? "Stop sharing" : "Share screen"} active={screenOn} onPress={toggleScreen} />
        <Control icon="camera-reverse-outline" label="Flip" onPress={() => void callRef.current?.cycleCamera().catch(() => setError("Could not switch cameras."))} />
        <Control icon="call-outline" label="End" danger onPress={() => void finish()} />
      </View>

      <View style={styles.transcriptPanel}>
        <Text style={styles.transcriptHeading}>Live transcript</Text>
        <ScrollView style={styles.transcriptScroll} contentContainerStyle={styles.transcriptContent}>
          {turns.length ? turns.map((turn, index) => (
            <View key={`${index}:${turn.role}:${turn.text}`} style={styles.turn}>
              <Text style={styles.turnRole}>{turn.role === "assistant" ? "KeatingBot" : "You"}</Text>
              <Text style={styles.turnText}>{turn.text}</Text>
            </View>
          )) : <Text style={styles.transcriptEmpty}>Captions and final utterances will appear here.</Text>}
        </ScrollView>
      </View>
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
    root: { flex: 1, gap: spacing.md },
    videoStage: {
      minHeight: 320,
      flex: 1,
      overflow: "hidden",
      borderRadius: radii.lg,
      backgroundColor: colors.backgroundDeep,
      borderWidth: 1,
      borderColor: colors.border,
    },
    remoteVideo: { width: "100%", height: "100%" },
    localVideo: {
      position: "absolute",
      right: spacing.md,
      bottom: spacing.md,
      width: 104,
      height: 144,
      borderRadius: radii.md,
      borderWidth: 2,
      borderColor: colors.background,
    },
    waiting: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
    waitingText: { ...type.body, color: colors.textMuted },
    statusBadge: {
      position: "absolute",
      top: spacing.md,
      left: spacing.md,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.xs,
      borderRadius: radii.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      backgroundColor: colors.background,
    },
    liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.error },
    statusText: { ...type.caption, color: colors.text },
    errorBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.errorSurface,
    },
    errorText: { ...type.body, flex: 1, color: colors.error },
    controls: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: spacing.sm },
    control: {
      minWidth: 84,
      minHeight: 52,
      alignItems: "center",
      justifyContent: "center",
      gap: 2,
      paddingHorizontal: spacing.sm,
      borderRadius: radii.md,
      backgroundColor: colors.surfaceRaised,
      borderWidth: 1,
      borderColor: colors.border,
    },
    controlActive: { borderColor: colors.primary, backgroundColor: colors.surfacePressed },
    controlDanger: { backgroundColor: colors.errorSurface, borderColor: colors.error },
    controlPressed: { opacity: 0.72 },
    controlLabel: { ...type.caption, color: colors.text },
    dangerText: { color: colors.error },
    transcriptPanel: {
      maxHeight: 210,
      borderTopWidth: 1,
      borderColor: colors.border,
      paddingTop: spacing.md,
    },
    transcriptHeading: { ...type.label, color: colors.text },
    transcriptScroll: { marginTop: spacing.sm },
    transcriptContent: { gap: spacing.md, paddingBottom: spacing.xl },
    transcriptEmpty: { ...type.body, color: colors.textMuted },
    turn: { gap: 2 },
    turnRole: { ...type.caption, color: colors.primary },
    turnText: { ...type.body, color: colors.text },
  });
}
