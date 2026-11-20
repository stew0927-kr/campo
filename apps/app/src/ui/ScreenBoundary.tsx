import { Component, type ReactNode } from 'react';
import { View } from 'react-native';
import { Body, Button, Heading } from './kit.tsx';
export class ScreenBoundary extends Component<{ children: ReactNode }, { error: boolean; generation: number }> {
  override state = { error: false, generation: 0 };
  static getDerivedStateFromError() { return { error: true }; }
  override render() {
    return this.state.error ? <View style={{ flex: 1, justifyContent: 'center', padding: 24, gap: 16 }}><Heading>화면을 표시하지 못했습니다.</Heading><Body>다시 시도해 주세요. 지도 데이터나 기기 지원 상태를 확인해야 할 수 있습니다.</Body><Button title="화면 다시 열기" onPress={() => this.setState((old) => ({ error: false, generation: old.generation + 1 }))} /></View> : <View key={this.state.generation} style={{ flex: 1 }}>{this.props.children}</View>;
  }
}
