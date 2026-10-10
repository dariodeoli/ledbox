import * as SecureStore from "expo-secure-store";
import type { SecretStore } from "./client";

const key = "ledbox.mobile.user-session.v1";
const options: SecureStore.SecureStoreOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
export const secureSession: SecretStore = {
  read: () => SecureStore.getItemAsync(key, options),
  write: token => SecureStore.setItemAsync(key, token, options),
  clear: () => SecureStore.deleteItemAsync(key, options),
};
