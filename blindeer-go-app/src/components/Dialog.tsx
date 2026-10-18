// Eigen meldings-/bevestigingsvenster met dezelfde API als React Native's Alert.alert.
// Nodig omdat Alert.alert in de webversie (website op het beginscherm) niets doet.
import React, { useEffect, useState } from 'react';
import { Modal, Text, View } from 'react-native';
import { space } from '../theme';
import { Button, styles as ui } from './ui';

export interface DialogButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

interface DialogState {
  title: string;
  message?: string;
  buttons: DialogButton[];
}

let show: ((d: DialogState) => void) | null = null;
const pending: DialogState[] = [];

export const Alert = {
  alert(title: string, message?: string, buttons?: DialogButton[]) {
    const d = { title, message, buttons: buttons?.length ? buttons : [{ text: 'OK' }] };
    if (show) show(d);
    else pending.push(d);
  },
};

export function DialogHost() {
  const [queue, setQueue] = useState<DialogState[]>([]);
  useEffect(() => {
    show = (d) => setQueue((q) => [...q, d]);
    if (pending.length) setQueue((q) => [...q, ...pending.splice(0)]);
    return () => {
      show = null;
    };
  }, []);
  const current = queue[0];
  const close = () => setQueue((q) => q.slice(1));
  const press = (b: DialogButton) => {
    close();
    b.onPress?.();
  };
  const stacked = (current?.buttons.length ?? 0) > 2;
  return (
    <Modal visible={!!current} transparent animationType="none" onRequestClose={() => {
      const cancel = current?.buttons.find((b) => b.style === 'cancel');
      if (cancel) press(cancel);
      else if (current?.buttons.length === 1) press(current.buttons[0]);
    }}>
      <View style={ui.modalBackdrop}>
        {current ? (
          <View style={ui.modalCard} accessibilityRole="alert">
            <Text style={ui.h2}>{current.title}</Text>
            {current.message ? <Text style={[ui.muted, { marginTop: space.sm }]}>{current.message}</Text> : null}
            <View style={{ flexDirection: stacked ? 'column' : 'row', gap: space.sm, marginTop: space.lg }}>
              {current.buttons.map((b) => (
                <Button
                  key={b.text}
                  title={b.text}
                  variant={b.style === 'cancel' ? 'secondary' : b.style === 'destructive' ? 'danger' : 'primary'}
                  onPress={() => press(b)}
                  style={stacked ? undefined : { flex: 1 }}
                />
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
