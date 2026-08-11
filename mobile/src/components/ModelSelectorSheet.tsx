import Ionicons from "@expo/vector-icons/Ionicons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Button } from "@/components/Buttons";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import {
  BUILT_IN_MODEL_CATALOG,
  type CatalogModel,
  catalogSections,
  customCatalogModel,
  filterCatalogModels,
  LONG_CONTEXT_THRESHOLD,
  mergeCatalogModels,
  MODEL_CAPABILITY_FILTERS,
  type ModelCapabilityFilter,
} from "@/lib/model-catalog";
import {
  addRecentModelKey,
  getRecentModelKeys,
  readCachedModelCatalog,
  refreshModelsDevCatalog,
} from "@/lib/model-catalog-storage";
import type { ProviderSettings } from "@/lib/types";

interface ModelSelectorSheetProps {
  visible: boolean;
  current: ProviderSettings;
  selectionDisabled?: boolean;
  onClose: () => void;
  onSelect: (model: CatalogModel) => void;
}

interface ModelSection {
  title: string;
  data: CatalogModel[];
}

export function ModelSelectorSheet({
  visible,
  current,
  selectionDisabled = false,
  onClose,
  onSelect,
}: ModelSelectorSheetProps) {
  const theme = useKeatingTheme();
  const { colors } = theme;
  const styles = createStyles(theme);
  const [catalog, setCatalog] = useState<CatalogModel[]>([...BUILT_IN_MODEL_CATALOG]);
  const [recentKeys, setRecentKeys] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [providerFilters, setProviderFilters] = useState<string[]>([]);
  const [capabilityFilters, setCapabilityFilters] = useState<ModelCapabilityFilter[]>([]);
  const [selectedKey, setSelectedKey] = useState(`${current.provider}::${current.model}`);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const requestId = useRef(0);
  const refreshController = useRef<AbortController | null>(null);
  const customModel = useMemo(() => customCatalogModel(current), [current]);

  const refresh = useCallback(async () => {
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    const activeRequest = ++requestId.current;
    setRefreshing(true);
    setRefreshError(null);
    try {
      const fresh = await refreshModelsDevCatalog(fetch, { signal: controller.signal });
      if (activeRequest !== requestId.current) return;
      setCatalog(mergeCatalogModels(BUILT_IN_MODEL_CATALOG, fresh, customModel ? [customModel] : []));
    } catch (error) {
      if (activeRequest !== requestId.current) return;
      setRefreshError(error instanceof Error ? error.message : "Could not refresh models.dev.");
    } finally {
      if (activeRequest === requestId.current) setRefreshing(false);
      if (refreshController.current === controller) refreshController.current = null;
    }
  }, [customModel]);

  useEffect(() => {
    if (!visible) {
      requestId.current += 1;
      refreshController.current?.abort();
      refreshController.current = null;
      return;
    }
    setSearch("");
    setProviderFilters([]);
    setCapabilityFilters([]);
    setSelectedKey(`${current.provider}::${current.model}`);
    let cancelled = false;
    Promise.all([readCachedModelCatalog(), getRecentModelKeys()])
      .then(([cached, recents]) => {
        if (cancelled) return;
        setCatalog(mergeCatalogModels(BUILT_IN_MODEL_CATALOG, cached, customModel ? [customModel] : []));
        setRecentKeys(recents);
      })
      .catch((error) => {
        if (!cancelled) setRefreshError(error instanceof Error ? error.message : "Could not load the saved model catalog.");
      })
      .finally(() => {
        if (!cancelled) void refresh();
      });
    return () => {
      cancelled = true;
      requestId.current += 1;
      refreshController.current?.abort();
      refreshController.current = null;
    };
  }, [current.model, current.provider, customModel, refresh, visible]);

  const providerOptions = useMemo(
    () => Array.from(new Set(catalog.map((model) => model.provider))),
    [catalog],
  );
  const filtered = useMemo(
    () => filterCatalogModels(catalog, search, providerFilters, capabilityFilters),
    [capabilityFilters, catalog, providerFilters, search],
  );
  const sections = useMemo<ModelSection[]>(() => {
    const grouped = catalogSections(filtered, recentKeys, search.trim() === "");
    return [
      { title: "Recent", data: grouped.recent },
      { title: "Cloud", data: grouped.cloud },
      { title: "Custom provider", data: grouped.custom },
    ].filter((section) => section.data.length > 0);
  }, [filtered, recentKeys, search]);
  const selected = catalog.find((model) => model.key === selectedKey);

  const toggleProvider = (provider: string) => {
    setProviderFilters((currentFilters) => currentFilters.includes(provider)
      ? currentFilters.filter((entry) => entry !== provider)
      : [...currentFilters, provider]);
  };
  const toggleCapability = (capability: ModelCapabilityFilter) => {
    setCapabilityFilters((currentFilters) => currentFilters.includes(capability)
      ? currentFilters.filter((entry) => entry !== capability)
      : [...currentFilters, capability]);
  };
  const useSelected = () => {
    if (!selected?.callable || selectionDisabled) return;
    onSelect(selected);
    void addRecentModelKey(selected.key).then(getRecentModelKeys).then(setRecentKeys).catch(() => undefined);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close model selector" style={styles.scrim} onPress={onClose} />
        <View accessibilityViewIsModal accessibilityLabel="Select model" style={styles.sheet}>
          <View style={styles.titleRow}>
            <View style={styles.titleCopy}>
              <Text style={styles.title}>Select model</Text>
              <Text style={styles.subtitle}>Searchable catalog from models.dev</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close model selector"
              onPress={onClose}
              style={({ pressed }) => [styles.iconButton, pressed && styles.controlPressed]}
            >
              <Ionicons name="close" size={22} color={colors.text} />
            </Pressable>
          </View>

          <View style={styles.searchRow}>
            <Ionicons name="search" size={18} color={colors.textFaint} />
            <TextInput
              autoFocus
              accessibilityLabel="Search models"
              placeholder="Search by model, ID, or provider"
              placeholderTextColor={colors.textFaint}
              value={search}
              onChangeText={setSearch}
              style={styles.searchInput}
            />
            {search ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear model search"
                onPress={() => setSearch("")}
                style={({ pressed }) => [styles.clearButton, pressed && styles.controlPressed]}
              >
                <Ionicons name="close-circle" size={20} color={colors.textMuted} />
              </Pressable>
            ) : null}
          </View>

          <View style={styles.filters}>
            <Text style={styles.filterLabel}>Providers</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.providerChipRow}
            >
              <FilterChip label="All" selected={providerFilters.length === 0} onPress={() => setProviderFilters([])} />
              {providerOptions.map((provider) => (
                <FilterChip
                  key={provider}
                  label={catalog.find((model) => model.provider === provider)?.providerLabel ?? provider}
                  selected={providerFilters.includes(provider)}
                  onPress={() => toggleProvider(provider)}
                />
              ))}
            </ScrollView>
            <Text style={styles.filterLabel}>Capabilities</Text>
            <View style={styles.chipRow}>
              <FilterChip label="All" selected={capabilityFilters.length === 0} onPress={() => setCapabilityFilters([])} />
              {MODEL_CAPABILITY_FILTERS.map((capability) => (
                <FilterChip
                  key={capability.value}
                  label={capability.label}
                  selected={capabilityFilters.includes(capability.value)}
                  onPress={() => toggleCapability(capability.value)}
                />
              ))}
            </View>
          </View>

          {refreshError ? (
            <View style={styles.errorBanner} accessibilityRole="alert">
              <View style={styles.errorCopy}>
                <Text style={styles.errorTitle}>Couldn’t refresh models.dev</Text>
                <Text numberOfLines={2} style={styles.errorText}>{refreshError} Showing saved and built-in models.</Text>
              </View>
              <Button compact variant="quiet" onPress={() => void refresh()}>Retry</Button>
            </View>
          ) : null}

          <View style={styles.resultsMeta}>
            <Text style={styles.resultsText}>{filtered.length} model{filtered.length === 1 ? "" : "s"} · {filtered.filter((model) => model.callable).length} callable</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh models from models.dev"
              disabled={refreshing}
              onPress={() => void refresh()}
              style={({ pressed }) => [styles.refreshButton, pressed && styles.controlPressed, refreshing && styles.disabled]}
            >
              {refreshing ? <ActivityIndicator size="small" color={colors.textMuted} /> : <Ionicons name="refresh" size={17} color={colors.textMuted} />}
              <Text style={styles.refreshText}>{refreshing ? "Refreshing" : "Refresh"}</Text>
            </Pressable>
          </View>

          <SectionList
            sections={sections}
            keyExtractor={(model) => model.key}
            keyboardShouldPersistTaps="handled"
            stickySectionHeadersEnabled
            style={styles.list}
            contentContainerStyle={sections.length === 0 ? styles.emptyList : styles.listContent}
            renderSectionHeader={({ section }) => <Text style={styles.sectionTitle}>{section.title}</Text>}
            renderItem={({ item }) => (
              <ModelRow
                model={item}
                selected={item.key === selectedKey}
                onPress={() => setSelectedKey(item.key)}
              />
            )}
            ListEmptyComponent={<Text style={styles.emptyText}>No models matched the current search and filters.</Text>}
          />

          <View style={styles.footer}>
            {selectionDisabled ? <Text style={styles.streamingNote}>Stop the current response to change models.</Text> : null}
            {selected && !selected.callable ? (
              <View style={styles.unavailableNotice} accessibilityRole="alert">
                <Text style={styles.unavailableTitle}>Unavailable</Text>
                <Text style={styles.unavailableText}>{selected.unavailabilityReason}</Text>
                <Text style={styles.unavailableHint}>Use Custom with a compatible endpoint, or choose a supported router such as OpenRouter.</Text>
              </View>
            ) : null}
            <View style={styles.footerActions}>
              <Button compact variant="secondary" onPress={onClose}>Cancel</Button>
              <Button compact disabled={!selected?.callable || selectionDisabled} onPress={useSelected}>Use selected model</Button>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function FilterChip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const styles = createStyles(useKeatingTheme());
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.controlPressed]}
    >
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

function ModelRow({ model, selected, onPress }: { model: CatalogModel; selected: boolean; onPress: () => void }) {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const { colors } = theme;
  const badges = [
    model.vision ? "Vision" : "",
    model.reasoning ? "Thinking" : "",
    model.contextWindow >= LONG_CONTEXT_THRESHOLD ? "Long context" : "",
  ].filter(Boolean);
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${model.name}, ${model.providerLabel}${model.callable ? "" : ". Unavailable: " + model.unavailabilityReason}`}
      onPress={onPress}
      style={({ pressed }) => [styles.modelRow, selected && styles.modelRowSelected, pressed && styles.controlPressed]}
    >
      <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={20} color={selected ? colors.primaryText : colors.textFaint} />
      <View style={styles.modelCopy}>
        <Text numberOfLines={1} style={styles.modelName}>{model.name}</Text>
        <Text numberOfLines={1} style={styles.modelId}>{model.providerLabel} · {model.id}</Text>
        {badges.length > 0 ? <Text numberOfLines={1} style={styles.badges}>{badges.join(" · ")}</Text> : null}
        {!model.callable ? (
          <>
            <Text numberOfLines={2} style={styles.unavailableRow}>Unavailable · {model.unavailabilityReason}</Text>
            <Text numberOfLines={2} style={styles.unavailableHint}>Use Custom with a compatible endpoint, or choose a supported router such as OpenRouter.</Text>
          </>
        ) : null}
      </View>
    </Pressable>
  );
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
    overlay: { flex: 1, justifyContent: "flex-end" },
    scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.overlay },
    sheet: {
      height: "92%",
      width: "100%",
      maxWidth: 760,
      alignSelf: "center",
      overflow: "hidden",
      backgroundColor: colors.background,
      borderTopLeftRadius: radii.lg,
      borderTopRightRadius: radii.lg,
      borderWidth: 1,
      borderColor: colors.borderStrong,
    },
    titleRow: {
      minHeight: 68,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    titleCopy: { flex: 1, minWidth: 0 },
    title: { ...type.heading, color: colors.text },
    subtitle: { ...type.caption, color: colors.textMuted, marginTop: 2 },
    iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radii.md },
    searchRow: {
      minHeight: 48,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginHorizontal: spacing.lg,
      marginTop: spacing.md,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderStrong,
      borderRadius: radii.md,
    },
    searchInput: { ...type.body, flex: 1, minWidth: 0, height: 46, color: colors.text },
    clearButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radii.md },
    filters: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
    filterLabel: { ...type.caption, ...type.monoBold, color: colors.textMuted, textTransform: "uppercase" },
    providerChipRow: { flexDirection: "row", gap: spacing.sm, paddingRight: spacing.lg },
    chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
    chip: {
      minHeight: 44,
      justifyContent: "center",
      paddingHorizontal: spacing.md,
      borderRadius: radii.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    chipSelected: { borderColor: colors.primaryStrong, backgroundColor: colors.surfaceRaised },
    chipText: { ...type.caption, color: colors.textMuted, fontWeight: "600" },
    chipTextSelected: { color: colors.primaryText },
    errorBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.sm,
      marginHorizontal: spacing.lg,
      marginBottom: spacing.sm,
      padding: spacing.md,
      borderRadius: radii.md,
      backgroundColor: colors.errorSurface,
      borderWidth: 1,
      borderColor: colors.error,
    },
    errorCopy: { flex: 1, minWidth: 0 },
    errorTitle: { ...type.label, color: colors.error, fontWeight: "700" },
    errorText: { ...type.caption, color: colors.error, marginTop: 2 },
    resultsMeta: {
      minHeight: 44,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: spacing.lg,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    resultsText: { ...type.caption, color: colors.textMuted },
    refreshButton: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, borderRadius: radii.md },
    refreshText: { ...type.caption, color: colors.textMuted, fontWeight: "600" },
    list: { flex: 1, backgroundColor: colors.backgroundDeep },
    listContent: { paddingBottom: spacing.lg },
    emptyList: { flexGrow: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
    emptyText: { ...type.body, color: colors.textMuted, textAlign: "center" },
    sectionTitle: {
      ...type.caption,
      ...type.mono,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.sm,
      color: colors.textMuted,
      backgroundColor: colors.backgroundDeep,
      fontWeight: "700",
      textTransform: "uppercase",
    },
    modelRow: {
      minHeight: 72,
      flexDirection: "row",
      alignItems: "center",
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      backgroundColor: colors.surface,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    modelRowSelected: { backgroundColor: colors.surfaceRaised, borderColor: colors.primaryStrong },
    modelCopy: { flex: 1, minWidth: 0 },
    modelName: { ...type.label, color: colors.text },
    modelId: { ...type.caption, ...type.mono, color: colors.textMuted, marginTop: 2 },
    badges: { ...type.caption, color: colors.primaryText, marginTop: spacing.xs },
    footer: { gap: spacing.sm, padding: spacing.lg, borderTopWidth: 1, borderTopColor: colors.border },
    streamingNote: { ...type.caption, color: colors.warning, textAlign: "right" },
    unavailableNotice: { gap: spacing.xs, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.errorSurface, borderWidth: 1, borderColor: colors.error },
    unavailableTitle: { ...type.label, color: colors.error, fontWeight: "700" },
    unavailableText: { ...type.caption, color: colors.error },
    unavailableHint: { ...type.caption, color: colors.textMuted },
    unavailableRow: { ...type.caption, color: colors.error, marginTop: spacing.xs },
    footerActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
    controlPressed: { backgroundColor: colors.surfacePressed },
    disabled: { opacity: 0.48 },
  });
}
