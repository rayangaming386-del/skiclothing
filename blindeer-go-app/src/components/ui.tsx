import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSettings } from '../lib/queries';
import { colors, font, onColor, radius, space } from '../theme';

export function useAccent() {
  const { data } = useSettings();
  return data?.accent_color ?? colors.primary;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
  footer,
  padded = true,
  edges = ['bottom'],
}: {
  children: React.ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
  footer?: React.ReactNode;
  padded?: boolean;
  edges?: ('top' | 'bottom')[];
}) {
  const content = scroll ? (
    <ScrollView
      contentContainerStyle={[padded && styles.padded, { paddingBottom: 32 }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.textDim} /> : undefined}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, padded && styles.padded]}>{children}</View>
  );
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
        {content}
        {footer ? <View style={styles.footer}>{footer}</View> : null}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Card({ children, onPress, style, accessibilityLabel }: { children: React.ReactNode; onPress?: () => void; style?: StyleProp<ViewStyle>; accessibilityLabel?: string }) {
  if (!onPress) return <View style={[styles.card, style]}>{children}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.card, style, pressed && { opacity: 0.75 }]}
    >
      {children}
    </Pressable>
  );
}

export function Section({ title, children, right }: { title?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <View style={{ marginTop: space.lg }}>
      {title ? (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Row({ label, value, onPress }: { label: string; value?: React.ReactNode; onPress?: () => void }) {
  const inner = (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={{ flexShrink: 1, alignItems: 'flex-end' }}>
        {typeof value === 'string' || typeof value === 'number' ? <Text style={styles.rowValue}>{value}</Text> : value}
      </View>
      {onPress ? <Text style={styles.chevron}>›</Text> : null}
    </View>
  );
  return onPress ? (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => pressed && { opacity: 0.7 }}>
      {inner}
    </Pressable>
  ) : (
    inner
  );
}

export const T = {
  H1: (p: { children: React.ReactNode; style?: object }) => <Text style={[styles.h1, p.style]}>{p.children}</Text>,
  H2: (p: { children: React.ReactNode; style?: object }) => <Text style={[styles.h2, p.style]}>{p.children}</Text>,
  Body: (p: { children: React.ReactNode; style?: object; numberOfLines?: number }) => (
    <Text style={[styles.body, p.style]} numberOfLines={p.numberOfLines}>
      {p.children}
    </Text>
  ),
  Muted: (p: { children: React.ReactNode; style?: object; numberOfLines?: number }) => (
    <Text style={[styles.muted, p.style]} numberOfLines={p.numberOfLines}>
      {p.children}
    </Text>
  ),
};

// ---------------------------------------------------------------------------
// Invoer
// ---------------------------------------------------------------------------
export function Button({
  title,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  big,
  icon,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  big?: boolean;
  icon?: string;
  style?: StyleProp<ViewStyle>;
}) {
  const accent = useAccent();
  const bg = variant === 'primary' ? accent : variant === 'danger' ? colors.danger : variant === 'secondary' ? colors.surface2 : 'transparent';
  const fg = variant === 'primary' || variant === 'danger' ? onColor(bg) : variant === 'ghost' ? accent : colors.text;
  const isDisabled = disabled || loading;
  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
      accessibilityLabel={title}
      style={({ pressed }) => [
        styles.button,
        big && styles.buttonBig,
        { backgroundColor: bg, borderColor: variant === 'secondary' ? colors.border : bg },
        isDisabled && { opacity: 0.5 },
        pressed && !isDisabled && { opacity: 0.8 },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.buttonText, big && { fontSize: font.large }, { color: fg }]}>
          {icon ? `${icon}  ` : ''}
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function Field({
  label,
  error,
  hint,
  style,
  ...props
}: TextInputProps & { label: string; error?: string | null; hint?: string }) {
  return (
    <View style={[{ marginBottom: space.md }, style as object]}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textFaint}
        style={[styles.input, props.multiline && { minHeight: 90, textAlignVertical: 'top' }, error ? { borderColor: colors.danger } : null]}
        accessibilityLabel={label}
        {...props}
      />
      {error ? <Text style={styles.error}>{error}</Text> : hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
  color,
  disabled,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  color?: string;
  disabled?: boolean;
}) {
  const accent = useAccent();
  const c = color ?? accent;
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      style={({ pressed }) => [
        styles.chip,
        selected && { backgroundColor: c, borderColor: c },
        disabled && { opacity: 0.4 },
        pressed && { opacity: 0.7 },
      ]}
    >
      {color && !selected ? <View style={[styles.dot, { backgroundColor: color }]} /> : null}
      <Text style={[styles.chipText, selected && { color: onColor(c), fontWeight: '700' }]}>
        {selected ? '✓ ' : ''}
        {label}
      </Text>
    </Pressable>
  );
}

export function ChipRow({ children, scroll }: { children: React.ReactNode; scroll?: boolean }) {
  if (scroll) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    );
  }
  return <View style={[styles.chipRow, { flexWrap: 'wrap' }]}>{children}</View>;
}

// ---------------------------------------------------------------------------
// Toestanden
// ---------------------------------------------------------------------------
export function Loading({ label = 'Laden…' }: { label?: string }) {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.textDim} size="large" />
      <Text style={[styles.muted, { marginTop: space.md }]}>{label}</Text>
    </View>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const msg = (error as { message?: string })?.message ?? 'Onbekende fout';
  const network = /network|fetch/i.test(msg);
  return (
    <View style={styles.center}>
      <Text style={styles.h2}>{network ? 'Geen verbinding' : 'Laden mislukt'}</Text>
      <Text style={[styles.muted, { textAlign: 'center', marginVertical: space.md }]}>
        {network ? 'Controleer je internetverbinding.' : msg}
      </Text>
      {onRetry ? <Button title="Opnieuw proberen" variant="secondary" onPress={onRetry} /> : null}
    </View>
  );
}

export function Empty({ title, text, action }: { title: string; text?: string; action?: React.ReactNode }) {
  return (
    <View style={[styles.center, { paddingVertical: 40 }]}>
      <Text style={styles.h2}>{title}</Text>
      {text ? <Text style={[styles.muted, { textAlign: 'center', marginTop: space.sm }]}>{text}</Text> : null}
      {action ? <View style={{ marginTop: space.lg, alignSelf: 'stretch' }}>{action}</View> : null}
    </View>
  );
}

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warning' | 'danger' | 'success'; children: React.ReactNode }) {
  const c = kind === 'warning' ? colors.warning : kind === 'danger' ? colors.danger : kind === 'success' ? colors.success : colors.info;
  return (
    <View style={[styles.notice, { borderColor: c }]}>
      <Text style={[styles.body, { color: colors.text }]}>{children}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Toast ("Opgeslagen"), zonder animatie
// ---------------------------------------------------------------------------
const ToastCtx = createContext<(msg: string, kind?: 'success' | 'error') => void>(() => undefined);
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; kind: 'success' | 'error' } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((msg: string, kind: 'success' | 'error' = 'success') => {
    if (timer.current) clearTimeout(timer.current);
    setToast({ msg, kind });
    timer.current = setTimeout(() => setToast(null), 2800);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast ? (
        <SafeAreaView edges={['bottom']} style={styles.toastWrap} pointerEvents="none">
          <View
            accessibilityLiveRegion="polite"
            style={[styles.toast, { backgroundColor: toast.kind === 'success' ? colors.success : colors.danger }]}
          >
            <Text style={styles.toastText}>
              {toast.kind === 'success' ? '✓ ' : '⚠ '}
              {toast.msg}
            </Text>
          </View>
        </SafeAreaView>
      ) : null}
    </ToastCtx.Provider>
  );
}

// ---------------------------------------------------------------------------
// Invoervenster (cross-platform alternatief voor Alert.prompt)
// ---------------------------------------------------------------------------
export function PromptModal({
  visible,
  title,
  message,
  placeholder,
  confirmLabel = 'Bevestigen',
  destructive,
  required,
  onCancel,
  onConfirm,
  loading,
}: {
  visible: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  confirmLabel?: string;
  destructive?: boolean;
  required?: boolean;
  onCancel: () => void;
  onConfirm: (value: string) => void;
  loading?: boolean;
}) {
  const [value, setValue] = useState('');
  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onCancel} onShow={() => setValue('')}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.modalBackdrop}>
        <View style={styles.modalCard}>
          <Text style={styles.h2}>{title}</Text>
          {message ? <Text style={[styles.muted, { marginVertical: space.sm }]}>{message}</Text> : null}
          <TextInput
            value={value}
            onChangeText={setValue}
            placeholder={placeholder}
            placeholderTextColor={colors.textFaint}
            style={[styles.input, { marginVertical: space.md }]}
            autoFocus
          />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button title="Terug" variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
            <Button
              title={confirmLabel}
              variant={destructive ? 'danger' : 'primary'}
              onPress={() => onConfirm(value.trim())}
              disabled={required && !value.trim()}
              loading={loading}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  padded: { padding: space.lg },
  footer: { padding: space.lg, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface, gap: space.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.lg, marginBottom: space.sm, borderWidth: 1, borderColor: colors.border },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm },
  sectionTitle: { color: colors.textDim, fontSize: font.small, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: space.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, gap: space.md },
  rowLabel: { color: colors.textDim, fontSize: font.body, flex: 1 },
  rowValue: { color: colors.text, fontSize: font.body, textAlign: 'right' },
  chevron: { color: colors.textFaint, fontSize: 22, marginLeft: space.xs },
  h1: { color: colors.text, fontSize: font.huge, fontWeight: '800' },
  h2: { color: colors.text, fontSize: font.title, fontWeight: '700' },
  body: { color: colors.text, fontSize: font.body },
  muted: { color: colors.textDim, fontSize: font.body },
  button: { minHeight: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg, borderWidth: 1 },
  buttonBig: { minHeight: 58 },
  buttonText: { fontSize: font.body, fontWeight: '700' },
  label: { color: colors.textDim, fontSize: font.small, fontWeight: '600', marginBottom: 6 },
  input: {
    backgroundColor: colors.surface2,
    color: colors.text,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: space.md,
    paddingVertical: 12,
    fontSize: font.body,
    minHeight: 48,
  },
  error: { color: colors.danger, fontSize: font.small, marginTop: 4 },
  hint: { color: colors.textFaint, fontSize: font.small, marginTop: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    minHeight: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface2,
  },
  chipText: { color: colors.text, fontSize: 15 },
  chipRow: { flexDirection: 'row', gap: space.sm, paddingVertical: 2 },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 6 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl },
  notice: { borderLeftWidth: 4, backgroundColor: colors.surface2, borderRadius: radius.sm, padding: space.md, marginVertical: space.sm },
  toastWrap: { position: 'absolute', left: 0, right: 0, bottom: 70, alignItems: 'center' },
  toast: { paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.md, maxWidth: '90%' },
  toastText: { color: '#fff', fontWeight: '700', fontSize: font.body },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: space.lg },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.lg, borderWidth: 1, borderColor: colors.border },
});
