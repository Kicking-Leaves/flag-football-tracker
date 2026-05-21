import React from 'react';
import { StyleSheet, View, StatusBar } from 'react-native';
import { WebView } from 'react-native-webview';

export default function App() {
  // YOUR GitHub Pages URL
  const appUrl = 'https://kickingleaves.github.io/flag-football-tracker';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#16a34a" />
      <WebView
        source={{ uri: appUrl }}
        style={styles.webview}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        startInLoadingState={true}
        scalesPageToFit={true}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#16a34a' },
  webview: { flex: 1 },
});
